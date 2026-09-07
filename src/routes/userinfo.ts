import { Hono } from 'hono'
import { getAccessGrant } from '../store.js'
import { buildUserInfoClaims } from '../scopes.js'
import { verifyAccessToken } from '../tokens.js'
import { findUserBySub } from '../users.js'

const app = new Hono()

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
    return c.json({ error: 'invalid_token', error_description: `invalid access token: ${token}` }, 401)
  }

  const grant = getAccessGrant(verified.jti)
  if (!grant) {
    c.header('WWW-Authenticate', 'Bearer')
    return c.json({ error: 'invalid_token', error_description: 'unknown or revoked access token' }, 401)
  }

  const user = findUserBySub(grant.sub)
  if (!user) {
    c.header('WWW-Authenticate', 'Bearer')
    return c.json({ error: 'invalid_token', error_description: 'subject no longer exists' }, 401)
  }

  if (!grant.scope.includes('openid')) {
    return c.json({ error: 'insufficient_scope', error_description: 'openid scope is required' }, 403)
  }

  return c.json(buildUserInfoClaims(user, grant.scope))
})

export default app
