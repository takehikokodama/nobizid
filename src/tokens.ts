import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { CLIENT_ID, ISSUER } from './config.js'
import { KID, getPrivateKey, getPublicKey } from './keys.js'

// GBizID docs: access_token有効時間は1時間
const ACCESS_TOKEN_TTL_SECONDS = 3600
// GBizID's sample refresh_token lives roughly 30 days longer than its
// matching access_token (not explicitly documented, inferred from the
// sample timestamps in the guideline).
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600

export type IssuedAccessToken = { token: string; jti: string; expiresIn: number }
export type IssuedRefreshToken = { token: string; jti: string }

export async function issueAccessToken(sub: string): Promise<IssuedAccessToken> {
  const jti = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ azp: CLIENT_ID })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .setJti(jti)
    .sign(getPrivateKey())
  return { token, jti, expiresIn: ACCESS_TOKEN_TTL_SECONDS }
}

export async function verifyAccessToken(token: string): Promise<{ sub: string; jti: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getPublicKey(), { issuer: ISSUER })
    if (!payload.sub || typeof payload.jti !== 'string') return null
    return { sub: payload.sub, jti: payload.jti }
  } catch {
    return null
  }
}

export async function issueIdToken(params: {
  sub: string
  nonce: string
  authTime: number
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ nonce: params.nonce, auth_time: params.authTime })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject(params.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .setJti(randomUUID())
    .sign(getPrivateKey())
}

// GBizID's real refresh_token is an *unsigned* JWT: header {"alg":"none"},
// a payload carrying only exp/jti, and an empty signature segment (trailing
// dot). We reproduce that exact shape rather than a signed or opaque token.
export function issueRefreshToken(): IssuedRefreshToken {
  const jti = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'none' }))
  const payload = base64url(JSON.stringify({ exp: now + REFRESH_TOKEN_TTL_SECONDS, jti }))
  return { token: `${header}.${payload}.`, jti }
}

export function parseRefreshToken(token: string): { jti: string; exp: number } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    if (typeof payload.jti !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return { jti: payload.jti, exp: payload.exp }
  } catch {
    return null
  }
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64url')
}
