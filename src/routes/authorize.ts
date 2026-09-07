import { Hono } from 'hono'
import { CLIENT_ID, GRANTED_OPTIONAL_SCOPES, REDIRECT_URI } from '../config.js'
import { resolveAuthorizeScopes } from '../scopes.js'
import { generateAuthCode, saveAuthCode } from '../store.js'
import { listUsernames, verifyCredentials } from '../users.js'

const app = new Hono()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function loginForm(params: {
  state: string
  nonce: string
  redirectUri: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: string
  usernameHint?: string
  error?: string
}) {
  const { state, nonce, redirectUri, scope, codeChallenge, codeChallengeMethod, usernameHint, error } = params
  const usernames = listUsernames()
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GビズID(ダミー) ログイン</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #FAFAFA;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #242424;
  }
  .card {
    width: 380px;
    max-width: calc(100vw - 32px);
    background: #FFFFFF;
    border-radius: 8px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.14), 0 0 2px rgba(0, 0, 0, 0.12);
    padding: 32px;
  }
  .title { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
  .subtitle { margin: 0 0 24px; font-size: 14px; color: #616161; }
  .banner {
    display: flex; align-items: flex-start; gap: 8px;
    background: #FDE7E9; color: #D13438; border-radius: 4px;
    padding: 12px; margin-bottom: 16px; font-size: 14px; line-height: 20px;
  }
  .field { margin-bottom: 16px; }
  label { display: block; margin-bottom: 4px; font-size: 14px; font-weight: 600; }
  input[type="text"], input[type="password"] {
    width: 100%; height: 32px; padding: 0 10px; font-size: 14px; font-family: inherit;
    color: #242424; background: #FFFFFF; border: 1px solid #D1D1D1; border-radius: 4px; outline: none;
  }
  input[type="text"]:focus, input[type="password"]:focus {
    border-color: #0F6CBD; box-shadow: 0 0 0 1px #0F6CBD;
  }
  button {
    width: 100%; height: 32px; margin-top: 8px; font-size: 14px; font-family: inherit;
    font-weight: 600; color: #FFFFFF; background: #0F6CBD; border: none; border-radius: 4px; cursor: pointer;
  }
  button:hover { background: #115EA3; }
  button:active { background: #0F548C; }
  .hint { margin-top: 16px; font-size: 12px; color: #616161; }
  .hint code { background: #F3F2F1; padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
  <div class="card">
    <p class="title">GビズID (ダミー)</p>
    <p class="subtitle">ローカル開発用ダミーログイン</p>
    ${error ? `<div class="banner" role="alert">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <input type="hidden" name="nonce" value="${escapeHtml(nonce)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}" />
      <div class="field">
        <label for="username">アカウントID</label>
        <input id="username" name="username" type="text" autocomplete="username" placeholder="username" value="${escapeHtml(usernameHint ?? '')}" />
      </div>
      <div class="field">
        <label for="password">パスワード</label>
        <input id="password" name="password" type="password" autocomplete="current-password" placeholder="password" />
      </div>
      <button type="submit">ログイン</button>
    </form>
    ${
      usernames.length > 0
        ? `<p class="hint">users.yaml に定義済みのアカウント: ${usernames.map((u) => `<code>${escapeHtml(u)}</code>`).join(' ')}</p>`
        : ''
    }
  </div>
</body>
</html>`
}

function redirectWithError(redirectUri: string, error: string, state: string | undefined, scope?: string) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (state) url.searchParams.set('state', state)
  if (scope) url.searchParams.set('scope', scope)
  return url.toString()
}

app.get('/oauth/authorize', (c) => {
  const clientId = c.req.query('client_id')
  const responseType = c.req.query('response_type')
  const redirectUriParam = c.req.query('redirect_uri')
  const scopeParam = c.req.query('scope')
  const state = c.req.query('state') ?? ''
  const nonce = c.req.query('nonce') ?? ''
  const loginHint = c.req.query('login_hint')
  const codeChallenge = c.req.query('code_challenge') ?? ''
  const codeChallengeMethod = c.req.query('code_challenge_method') ?? ''

  // invalid_client / invalid_grant (bad redirect_uri) are shown on an error
  // page rather than redirected, matching the guideline.
  if (!clientId || clientId !== CLIENT_ID) {
    return c.text('invalid_client: unknown client_id', 400)
  }
  const redirectUri = redirectUriParam ?? REDIRECT_URI
  if (redirectUri !== REDIRECT_URI) {
    return c.text('invalid_grant: unknown redirect_uri', 400)
  }

  if (!responseType) {
    return c.redirect(redirectWithError(redirectUri, 'invalid_request', state), 302)
  }
  if (responseType !== 'code') {
    return c.redirect(redirectWithError(redirectUri, 'unsupported_response_type', state), 302)
  }
  if (codeChallenge && codeChallengeMethod !== 'S256') {
    return c.redirect(redirectWithError(redirectUri, 'invalid_request', state), 302)
  }

  const scopes = resolveAuthorizeScopes(scopeParam, GRANTED_OPTIONAL_SCOPES)
  if (scopes === 'invalid_scope') {
    return c.redirect(redirectWithError(redirectUri, 'invalid_scope', state, scopeParam), 302)
  }

  return c.html(
    loginForm({
      state,
      nonce,
      redirectUri,
      scope: scopes.join(' '),
      codeChallenge,
      codeChallengeMethod,
      usernameHint: loginHint,
    }),
  )
})

app.post('/oauth/authorize', async (c) => {
  const body = await c.req.parseBody()
  const state = String(body.state ?? '')
  const nonce = String(body.nonce ?? '')
  const redirectUri = String(body.redirect_uri ?? '')
  const scope = String(body.scope ?? '')
  const codeChallenge = String(body.code_challenge ?? '')
  const codeChallengeMethod = String(body.code_challenge_method ?? '')
  const username = String(body.username ?? '')
  const password = String(body.password ?? '')

  const user = verifyCredentials(username, password)
  if (!user) {
    return c.html(
      loginForm({
        state,
        nonce,
        redirectUri,
        scope,
        codeChallenge,
        codeChallengeMethod,
        usernameHint: username,
        error: 'アカウントIDまたはパスワードが違います',
      }),
      401,
    )
  }

  const code = generateAuthCode()
  saveAuthCode(code, {
    sub: user.sub,
    clientId: CLIENT_ID,
    scope: scope.split(' ').filter(Boolean),
    nonce,
    authTime: Math.floor(Date.now() / 1000),
    codeChallenge: codeChallenge || undefined,
  })

  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return c.redirect(url.toString(), 302)
})

export default app
