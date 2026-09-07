import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } from '../config.js'
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

  if (!code || redirectUri !== REDIRECT_URI) {
    return c.json({ error: 'invalid_request', error_description: 'missing or mismatched parameters' }, 400)
  }

  const record = consumeAuthCode(code)
  if (!record) {
    return c.json({ error: 'invalid_grant', error_description: `no authorization code found for value ${code}` }, 400)
  }

  if (record.codeChallenge) {
    if (!codeVerifier) {
      return c.json({ error: 'invalid_grant', error_description: 'code_verifier is required' }, 400)
    }
    const expectedChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    if (expectedChallenge !== record.codeChallenge) {
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
  })

  const idToken = await issueIdToken({ sub: record.sub, nonce: record.nonce, authTime: record.authTime })

  const response: Record<string, unknown> = {
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: access.expiresIn,
    scope: record.scope.join(' '),
    id_token: idToken,
  }

  if (record.scope.includes('offline_access')) {
    const refresh = issueRefreshToken()
    saveRefreshGrant(refresh.jti, {
      sub: record.sub,
      clientId: record.clientId,
      scope: record.scope,
      nonce: record.nonce,
      authTime: record.authTime,
    })
    response.refresh_token = refresh.token
  }

  return c.json(response)
}

async function handleRefreshTokenGrant(c: Context, body: Record<string, unknown>) {
  const refreshTokenParam = String(body.refresh_token ?? '')
  const scopeParam = body.scope ? String(body.scope) : undefined

  const parsed = parseRefreshToken(refreshTokenParam)
  if (!parsed) {
    return c.json({ error: 'invalid_token', error_description: `invalid refresh token: ${refreshTokenParam}` }, 401)
  }

  const record = consumeRefreshGrant(parsed.jti)
  if (!record) {
    return c.json({ error: 'invalid_token', error_description: `invalid refresh token: ${refreshTokenParam}` }, 401)
  }

  const scopes = resolveRefreshScopes(scopeParam, record.scope)
  if (scopes === 'invalid_scope') {
    return c.json({ error: 'invalid_scope', error_description: 'requested scope exceeds the original grant' }, 401)
  }

  const access = await issueAccessToken(record.sub)
  saveAccessGrant(access.jti, { ...record, scope: scopes })

  const idToken = await issueIdToken({ sub: record.sub, nonce: record.nonce, authTime: record.authTime })

  const refresh = issueRefreshToken()
  saveRefreshGrant(refresh.jti, { ...record, scope: scopes })

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
