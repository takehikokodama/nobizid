import { Hono } from 'hono'
import { BASE_SCOPES, OPTIONAL_SCOPES } from '../scopes.js'
import {
  AUTHORIZATION_ENDPOINT,
  ISSUER,
  JWKS_ENDPOINT,
  TOKEN_ENDPOINT,
  USERINFO_ENDPOINT,
} from '../config.js'

const app = new Hono()

// Real GBizID path: {issuer}.well-known/openid-configuration. Not
// explicitly documented in the developer guideline PDF, but this is where
// standard OIDC discovery would land given the documented issuer/jwks_uri
// relationship, so we serve it here for convenience.
app.get('/oauth/.well-known/openid-configuration', (c) => {
  return c.json({
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    userinfo_endpoint: USERINFO_ENDPOINT,
    jwks_uri: JWKS_ENDPOINT,
    scopes_supported: [...BASE_SCOPES, ...OPTIONAL_SCOPES],
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  })
})

export default app
