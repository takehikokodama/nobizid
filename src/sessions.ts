// In-memory trace of OIDC protocol sessions, for the /admin/logins debug
// screen. A "session" begins at GET /oauth/authorize (regardless of whether
// login ultimately succeeds) so failed/abandoned flows show up too, not
// just clean logins. Everything that happens afterward for the same flow
// (login attempts, token exchanges, userinfo calls) is appended to the same
// session's timeline via the correlation indices below.
//
import { randomUUID } from 'node:crypto'

// These indices are intentionally separate from store.ts's authCodes/
// accessGrants/refreshGrants maps: those exist to enforce single-use codes
// and look up live grants for real request handling, and get cleared or
// left unbounded accordingly. Here we want to find a session *even when*
// its code was already consumed, expired, or its token failed signature
// verification, purely so the debug UI can show what went wrong.

export type StepError = { error: string; errorDescription?: string }

export type AuthorizeGetEntry = {
  kind: 'authorize_get'
  at: number
  clientId: string
  redirectUri: string
  scopeParamRaw: string | null
  resolvedScope: string[] | null
  state: string
  nonce: string
  pkce: boolean
  codeChallengeMethod: string | null
  error: StepError | null
}

export type AuthorizePostEntry = {
  kind: 'authorize_post'
  at: number
  username: string
  state: string
  success: boolean
  sub: string | null
  code: string | null
}

export type TokenPostEntry = {
  kind: 'token_post'
  at: number
  grantType: string
  clientAuthMethod: 'client_secret_basic'
  redirectUri: string | null
  codeVerifierProvided: boolean
  success: boolean
  idTokenClaims: Record<string, unknown> | null
  accessTokenClaims: Record<string, unknown> | null
  scope: string[] | null
  hasRefreshToken: boolean
  error: StepError | null
}

export type UserinfoGetEntry = {
  kind: 'userinfo_get'
  at: number
  scope: string[] | null
  success: boolean
  claims: Record<string, unknown> | null
  error: StepError | null
}

export type TimelineEntry = AuthorizeGetEntry | AuthorizePostEntry | TokenPostEntry | UserinfoGetEntry

export type OidcSession = {
  id: string
  createdAt: number
  timeline: TimelineEntry[]
}

const MAX_SESSIONS = 20

const sessions: OidcSession[] = []
const byId = new Map<string, OidcSession>()
const byCode = new Map<string, string>()
const byAccessTokenJti = new Map<string, string>()
const byRefreshTokenJti = new Map<string, string>()
// Tracks which keys each session registered in the maps above, so eviction
// can remove exactly those entries instead of leaking them forever.
const indexedKeysBySessionId = new Map<string, { codes: string[]; accessJtis: string[]; refreshJtis: string[] }>()

function evictOldest(): void {
  while (sessions.length > MAX_SESSIONS) {
    const removed = sessions.pop()
    if (!removed) break
    byId.delete(removed.id)
    const keys = indexedKeysBySessionId.get(removed.id)
    if (keys) {
      for (const code of keys.codes) byCode.delete(code)
      for (const jti of keys.accessJtis) byAccessTokenJti.delete(jti)
      for (const jti of keys.refreshJtis) byRefreshTokenJti.delete(jti)
      indexedKeysBySessionId.delete(removed.id)
    }
  }
}

export function startSession(entry: Omit<AuthorizeGetEntry, 'kind'>): string {
  const id = randomUUID()
  const session: OidcSession = {
    id,
    createdAt: entry.at,
    timeline: [{ kind: 'authorize_get', ...entry }],
  }
  sessions.unshift(session)
  byId.set(id, session)
  indexedKeysBySessionId.set(id, { codes: [], accessJtis: [], refreshJtis: [] })
  evictOldest()
  return id
}

export function recordAuthorizeGetError(sessionId: string, error: StepError): void {
  const session = byId.get(sessionId)
  const entry = session?.timeline.find((e): e is AuthorizeGetEntry => e.kind === 'authorize_get')
  if (entry) entry.error = error
}

export function recordAuthorizePost(sessionId: string, entry: Omit<AuthorizePostEntry, 'kind'>): void {
  byId.get(sessionId)?.timeline.push({ kind: 'authorize_post', ...entry })
}

export function indexCode(code: string, sessionId: string): void {
  byCode.set(code, sessionId)
  indexedKeysBySessionId.get(sessionId)?.codes.push(code)
}

export function getSessionIdForCode(code: string): string | null {
  return byCode.get(code) ?? null
}

export function indexAccessToken(jti: string, sessionId: string): void {
  byAccessTokenJti.set(jti, sessionId)
  indexedKeysBySessionId.get(sessionId)?.accessJtis.push(jti)
}

export function getSessionIdForAccessToken(jti: string): string | null {
  return byAccessTokenJti.get(jti) ?? null
}

export function indexRefreshToken(jti: string, sessionId: string): void {
  byRefreshTokenJti.set(jti, sessionId)
  indexedKeysBySessionId.get(sessionId)?.refreshJtis.push(jti)
}

export function getSessionIdForRefreshToken(jti: string): string | null {
  return byRefreshTokenJti.get(jti) ?? null
}

export function recordTokenExchange(sessionId: string, entry: Omit<TokenPostEntry, 'kind'>): void {
  byId.get(sessionId)?.timeline.push({ kind: 'token_post', ...entry })
}

export function recordUserinfoCall(sessionId: string, entry: Omit<UserinfoGetEntry, 'kind'>): void {
  byId.get(sessionId)?.timeline.push({ kind: 'userinfo_get', ...entry })
}

let lastDiscoveryFetchAt: number | null = null

export function recordDiscoveryFetch(): void {
  lastDiscoveryFetchAt = Date.now()
}

export function getLastDiscoveryFetch(): number | null {
  return lastDiscoveryFetchAt
}

export function getRecentSessions(limit: number): OidcSession[] {
  return sessions.slice(0, limit)
}
