import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { CLIENT_ID, CLIENT_SECRET, ISSUER, REDIRECT_URI } from '../config.js'
import * as sessions from '../sessions.js'
import { resolveRefreshScopes } from '../scopes.js'
import {
  consumeAuthCode,
  consumeRefreshGrant,
  saveAccessGrant,
  saveRefreshGrant,
} from '../store.js'
import { issueAccessToken, issueIdToken, issueRefreshToken, parseRefreshToken } from '../tokens.js'

const app = new Hono()

function parseBasicAuth(header: string | undefined): { clientId: string; clientSecret: string } | null {
  if (!header?.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8')
  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex === -1) return null
  return { clientId: decoded.slice(0, separatorIndex), clientSecret: decoded.slice(separatorIndex + 1) }
}

app.post('/oauth/token', async (c) => {
  const credentials = parseBasicAuth(c.req.header('authorization'))
  if (!credentials || credentials.clientId !== CLIENT_ID || credentials.clientSecret !== CLIENT_SECRET) {
    // No code/refresh_token has been parsed yet at this point, so there's
    // nothing to correlate a session by.
    return c.json({ error: 'unauthorized', error_description: 'client authentication failed' }, 401)
  }

  const body = await c.req.parseBody()
  const grantType = String(body.grant_type ?? '')

  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(c, body)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(c, body)
  }
  return c.json({ error: 'unsupported_grant_type', error_description: `unsupported grant_type: ${grantType}` }, 400)
})

async function handleAuthorizationCodeGrant(c: Context, body: Record<string, unknown>) {
  const code = String(body.code ?? '')
  const redirectUri = String(body.redirect_uri ?? '')
  const codeVerifier = body.code_verifier ? String(body.code_verifier) : undefined
  const sessionId = sessions.getSessionIdForCode(code)

  const recordFailure = (error: string, errorDescription?: string) => {
    if (sessionId) {
      sessions.recordTokenExchange(sessionId, {
        at: Date.now(),
        grantType: 'authorization_code',
        clientAuthMethod: 'client_secret_basic',
        redirectUri: redirectUri || null,
        codeVerifierProvided: Boolean(codeVerifier),
        success: false,
        idTokenClaims: null,
        accessTokenClaims: null,
        scope: null,
        hasRefreshToken: false,
        error: { error, errorDescription },
      })
    }
  }

  if (!code || redirectUri !== REDIRECT_URI) {
    recordFailure('invalid_request', 'missing or mismatched parameters')
    return c.json({ error: 'invalid_request', error_description: 'missing or mismatched parameters' }, 400)
  }

  const record = consumeAuthCode(code)
  if (!record) {
    recordFailure('invalid_grant', `no authorization code found for value ${code}`)
    return c.json({ error: 'invalid_grant', error_description: `no authorization code found for value ${code}` }, 400)
  }

  if (record.codeChallenge) {
    if (!codeVerifier) {
      recordFailure('invalid_grant', 'code_verifier is required')
      return c.json({ error: 'invalid_grant', error_description: 'code_verifier is required' }, 400)
    }
    const expectedChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    if (expectedChallenge !== record.codeChallenge) {
      recordFailure('invalid_grant', 'code_verifier does not match code_challenge')
      return c.json({ error: 'invalid_grant', error_description: 'code_verifier does not match code_challenge' }, 400)
    }
  }

  const access = await issueAccessToken(record.sub)
  saveAccessGrant(access.jti, {
    sub: record.sub,
    clientId: record.clientId,
    scope: record.scope,
    nonce: record.nonce,
    authTime: record.authTime,
    sessionId: record.sessionId,
  })
  sessions.indexAccessToken(access.jti, record.sessionId)

  const now = Math.floor(Date.now() / 1000)
  const accessTokenClaims = { azp: record.clientId, iss: ISSUER, sub: record.sub, iat: now, exp: now + access.expiresIn, jti: access.jti }
  const idTokenClaims = {
    sub: record.sub,
    aud: record.clientId,
    iss: ISSUER,
    exp: now + access.expiresIn,
    iat: now,
    auth_time: record.authTime,
    nonce: record.nonce,
  }
  const idToken = await issueIdToken({ sub: record.sub, nonce: record.nonce, authTime: record.authTime })

  const response: Record<string, unknown> = {
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: access.expiresIn,
    scope: record.scope.join(' '),
    id_token: idToken,
  }

  let hasRefreshToken = false
  if (record.scope.includes('offline_access')) {
    const refresh = issueRefreshToken()
    saveRefreshGrant(refresh.jti, {
      sub: record.sub,
      clientId: record.clientId,
      scope: record.scope,
      nonce: record.nonce,
      authTime: record.authTime,
      sessionId: record.sessionId,
    })
    sessions.indexRefreshToken(refresh.jti, record.sessionId)
    response.refresh_token = refresh.token
    hasRefreshToken = true
  }

  sessions.recordTokenExchange(record.sessionId, {
    at: Date.now(),
    grantType: 'authorization_code',
    clientAuthMethod: 'client_secret_basic',
    redirectUri,
    codeVerifierProvided: Boolean(codeVerifier),
    success: true,
    idTokenClaims,
    accessTokenClaims,
    scope: record.scope,
    hasRefreshToken,
    error: null,
  })

  return c.json(response)
}

async function handleRefreshTokenGrant(c: Context, body: Record<string, unknown>) {
  const refreshTokenParam = String(body.refresh_token ?? '')
  const scopeParam = body.scope ? String(body.scope) : undefined

  const parsed = parseRefreshToken(refreshTokenParam)
  const sessionId = parsed ? sessions.getSessionIdForRefreshToken(parsed.jti) : null

  const recordFailure = (error: string, errorDescription?: string) => {
    if (sessionId) {
      sessions.recordTokenExchange(sessionId, {
        at: Date.now(),
        grantType: 'refresh_token',
        clientAuthMethod: 'client_secret_basic',
        redirectUri: null,
        codeVerifierProvided: false,
        success: false,
        idTokenClaims: null,
        accessTokenClaims: null,
        scope: null,
        hasRefreshToken: false,
        error: { error, errorDescription },
      })
    }
  }

  if (!parsed) {
    recordFailure('invalid_token', `invalid refresh token: ${refreshTokenParam}`)
    return c.json({ error: 'invalid_token', error_description: `invalid refresh token: ${refreshTokenParam}` }, 401)
  }

  const record = consumeRefreshGrant(parsed.jti)
  if (!record) {
    recordFailure('invalid_token', `invalid refresh token: ${refreshTokenParam}`)
    return c.json({ error: 'invalid_token', error_description: `invalid refresh token: ${refreshTokenParam}` }, 401)
  }

  const scopes = resolveRefreshScopes(scopeParam, record.scope)
  if (scopes === 'invalid_scope') {
    recordFailure('invalid_scope', 'requested scope exceeds the original grant')
    return c.json({ error: 'invalid_scope', error_description: 'requested scope exceeds the original grant' }, 401)
  }

  const access = await issueAccessToken(record.sub)
  saveAccessGrant(access.jti, { ...record, scope: scopes })
  sessions.indexAccessToken(access.jti, record.sessionId)

  const now = Math.floor(Date.now() / 1000)
  const accessTokenClaims = { azp: record.clientId, iss: ISSUER, sub: record.sub, iat: now, exp: now + access.expiresIn, jti: access.jti }
  const idTokenClaims = {
    sub: record.sub,
    aud: record.clientId,
    iss: ISSUER,
    exp: now + access.expiresIn,
    iat: now,
    auth_time: record.authTime,
    nonce: record.nonce,
  }
  const idToken = await issueIdToken({ sub: record.sub, nonce: record.nonce, authTime: record.authTime })

  const refresh = issueRefreshToken()
  saveRefreshGrant(refresh.jti, { ...record, scope: scopes })
  sessions.indexRefreshToken(refresh.jti, record.sessionId)

  sessions.recordTokenExchange(record.sessionId, {
    at: Date.now(),
    grantType: 'refresh_token',
    clientAuthMethod: 'client_secret_basic',
    redirectUri: null,
    codeVerifierProvided: false,
    success: true,
    idTokenClaims,
    accessTokenClaims,
    scope: scopes,
    hasRefreshToken: true,
    error: null,
  })

  return c.json({
    access_token: access.token,
    token_type: 'Bearer',
    refresh_token: refresh.token,
    expires_in: access.expiresIn,
    scope: scopes.join(' '),
    id_token: idToken,
  })
}

export default app
