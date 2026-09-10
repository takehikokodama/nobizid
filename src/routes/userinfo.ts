import { Hono } from 'hono'
import { decodeJwt } from 'jose'
import * as sessions from '../sessions.js'
import { getAccessGrant } from '../store.js'
import { buildUserInfoClaims } from '../scopes.js'
import { verifyAccessToken } from '../tokens.js'
import { findUserBySub } from '../users.js'

const app = new Hono()

// Best-effort session lookup for a token that failed verification (expired,
// bad signature, or simply unknown to us): peek at its jti without
// verifying anything, purely so the debug history can still show that this
// request happened and where it belongs. A token that isn't even
// JWT-shaped can't be attributed to any session, and that's fine.
function trySessionIdFromUnverifiedToken(token: string): string | null {
  try {
    const payload = decodeJwt(token)
    if (typeof payload.jti !== 'string') return null
    return sessions.getSessionIdForAccessToken(payload.jti)
  } catch {
    return null
  }
}

app.get('/oauth/userinfo', async (c) => {
  const auth = c.req.header('authorization')
  if (!auth?.startsWith('Bearer ')) {
    c.header('WWW-Authenticate', 'Bearer')
    return c.json({ error: 'invalid_token', error_description: 'missing bearer token' }, 401)
  }

  const token = auth.slice('Bearer '.length)
  const verified = await verifyAccessToken(token)
  if (!verified) {
    c.header('WWW-Authenticate', 'Bearer')
    const sessionId = trySessionIdFromUnverifiedToken(token)
    if (sessionId) {
      sessions.recordUserinfoCall(sessionId, {
        at: Date.now(),
        scope: null,
        success: false,
        claims: null,
        error: { error: 'invalid_token', errorDescription: `invalid access token: ${token}` },
      })
    }
    return c.json({ error: 'invalid_token', error_description: `invalid access token: ${token}` }, 401)
  }

  const grant = getAccessGrant(verified.jti)
  if (!grant) {
    c.header('WWW-Authenticate', 'Bearer')
    const sessionId = sessions.getSessionIdForAccessToken(verified.jti)
    if (sessionId) {
      sessions.recordUserinfoCall(sessionId, {
        at: Date.now(),
        scope: null,
        success: false,
        claims: null,
        error: { error: 'invalid_token', errorDescription: 'unknown or revoked access token' },
      })
    }
    return c.json({ error: 'invalid_token', error_description: 'unknown or revoked access token' }, 401)
  }

  const user = findUserBySub(grant.sub)
  if (!user) {
    c.header('WWW-Authenticate', 'Bearer')
    sessions.recordUserinfoCall(grant.sessionId, {
      at: Date.now(),
      scope: grant.scope,
      success: false,
      claims: null,
      error: { error: 'invalid_token', errorDescription: 'subject no longer exists' },
    })
    return c.json({ error: 'invalid_token', error_description: 'subject no longer exists' }, 401)
  }

  if (!grant.scope.includes('openid')) {
    sessions.recordUserinfoCall(grant.sessionId, {
      at: Date.now(),
      scope: grant.scope,
      success: false,
      claims: null,
      error: { error: 'insufficient_scope', errorDescription: 'openid scope is required' },
    })
    return c.json({ error: 'insufficient_scope', error_description: 'openid scope is required' }, 403)
  }

  const claims = buildUserInfoClaims(user, grant.scope)
  sessions.recordUserinfoCall(grant.sessionId, {
    at: Date.now(),
    scope: grant.scope,
    success: true,
    claims,
    error: null,
  })

  return c.json(claims)
})

export default app
