import { randomBytes } from 'node:crypto'

export type GrantRecord = {
  sub: string
  clientId: string
  scope: string[]
  nonce: string
  authTime: number
  // Links this grant back to the originating login for /admin/logins.
  loginId: string
}

export type AuthCodeRecord = GrantRecord & {
  codeChallenge?: string
  expiresAt: number
}

// GBizID docs: 認可コードの有効期限は5分
const AUTH_CODE_TTL_MS = 5 * 60_000

const authCodes = new Map<string, AuthCodeRecord>()
// Access tokens are self-contained signed JWTs, but GBizID's real access
// token does not embed a `scope` claim. To still know what a bearer token is
// allowed to see at the UserInfo endpoint, we keep the scope grant here,
// keyed by the token's `jti` (this mirrors how a real resource server would
// look up a server-side session/grant instead of trusting client-supplied
// claims). See gbizid-dummy-op-spec.md for this documented deviation.
const accessGrants = new Map<string, GrantRecord>()
const refreshGrants = new Map<string, GrantRecord>()

function randomAlphanumeric(length: number): string {
  let out = ''
  while (out.length < length) {
    out += randomBytes(length).toString('base64url').replace(/[^a-zA-Z0-9]/g, '')
  }
  return out.slice(0, length)
}

// GBizID docs: 認可コードは半角英数字22桁
export function generateAuthCode(): string {
  return randomAlphanumeric(22)
}

export function saveAuthCode(code: string, rec: Omit<AuthCodeRecord, 'expiresAt'>): void {
  authCodes.set(code, { ...rec, expiresAt: Date.now() + AUTH_CODE_TTL_MS })
}

export function consumeAuthCode(code: string): AuthCodeRecord | null {
  const rec = authCodes.get(code)
  authCodes.delete(code)
  if (!rec || rec.expiresAt < Date.now()) return null
  return rec
}

export function saveAccessGrant(jti: string, rec: GrantRecord): void {
  accessGrants.set(jti, rec)
}

export function getAccessGrant(jti: string): GrantRecord | null {
  return accessGrants.get(jti) ?? null
}

export function saveRefreshGrant(jti: string, rec: GrantRecord): void {
  refreshGrants.set(jti, rec)
}

// Refresh tokens rotate: each use consumes the old one and a new one is issued.
export function consumeRefreshGrant(jti: string): GrantRecord | null {
  const rec = refreshGrants.get(jti)
  refreshGrants.delete(jti)
  return rec ?? null
}
