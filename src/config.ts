export const PORT = Number(process.env.PORT ?? 7999)

const ORIGIN = process.env.GBIZID_ORIGIN ?? `http://localhost:${PORT}`

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

// GBizID's real issuer is "https://gbiz-id.go.jp/oauth/" (trailing slash).
// Discovery is issuer + ".well-known/openid-configuration", so keeping the
// trailing slash here makes every derived endpoint path match the real
// service's layout automatically.
export const ISSUER = withTrailingSlash(process.env.GBIZID_ISSUER ?? `${ORIGIN}/oauth/`)

export const CLIENT_ID = process.env.GBIZID_CLIENT_ID ?? 'local-client-id'
export const CLIENT_SECRET = process.env.GBIZID_CLIENT_SECRET ?? 'local-client-secret'
export const REDIRECT_URI = process.env.GBIZID_REDIRECT_URI ?? 'http://localhost:3000/callback'

export const USERS_FILE = process.env.GBIZID_USERS_FILE ?? './users.yaml'

// Scopes that require prior arrangement with GBizID (RP設定申込) before they
// can be requested. Modeled here as "already arranged" for this dummy client.
export const GRANTED_OPTIONAL_SCOPES = (
  process.env.GBIZID_GRANTED_OPTIONAL_SCOPES ?? 'jp_gbizid_v1_ida,role,delegation_info'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const AUTHORIZATION_ENDPOINT = `${ISSUER}authorize`
export const TOKEN_ENDPOINT = `${ISSUER}token`
export const USERINFO_ENDPOINT = `${ISSUER}userinfo`
export const DISCOVERY_ENDPOINT = `${ISSUER}.well-known/openid-configuration`
export const JWKS_ENDPOINT = `${ISSUER}.well-known/jwks.json`
