import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const PORT = Number(process.env.PORT ?? 3000)

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

// Matches nobizid's own config.ts: ISSUER ends with a trailing slash and
// every endpoint is a plain suffix of it.
const ISSUER = withTrailingSlash(process.env.GBIZID_ISSUER ?? 'http://localhost:7999/oauth/')
const CLIENT_ID = process.env.GBIZID_CLIENT_ID ?? 'local-client-id'
const CLIENT_SECRET = process.env.GBIZID_CLIENT_SECRET ?? 'local-client-secret'
const REDIRECT_URI = process.env.GBIZID_REDIRECT_URI ?? `http://localhost:${PORT}/callback`
const LOGOUT_URI = process.env.GBIZID_LOGOUT_URI ?? `http://localhost:${PORT}/`

const AUTHORIZATION_ENDPOINT = `${ISSUER}authorize`
const TOKEN_ENDPOINT = `${ISSUER}token`
const USERINFO_ENDPOINT = `${ISSUER}userinfo`
const JWKS_ENDPOINT = `${ISSUER}.well-known/jwks.json`
// nobizid's /logout lives at the origin root, not under /oauth/.
const OP_ORIGIN = new URL(ISSUER).origin

const JWKS = createRemoteJWKSet(new URL(JWKS_ENDPOINT))

type ScopeOption = { value: string; description: string; optional: boolean; defaultOn: boolean }

const SCOPE_OPTIONS: ScopeOption[] = [
  { value: 'openid', description: 'アカウント識別情報（sub）', optional: false, defaultOn: true },
  { value: 'profile', description: '法人の基本情報（法人番号・商号・代表者名など）', optional: false, defaultOn: true },
  { value: 'user', description: 'アカウント利用者情報（氏名・部署・連絡先など）', optional: false, defaultOn: true },
  { value: 'email', description: 'アカウントID（メールアドレス）', optional: false, defaultOn: true },
  { value: 'mandate', description: 'gBizIDメンバーが委任するRPの情報', optional: false, defaultOn: false },
  { value: 'offline_access', description: 'リフレッシュトークンの発行', optional: false, defaultOn: false },
  { value: 'jp_gbizid_v1_ida', description: '本人確認情報（verified_claims）', optional: true, defaultOn: false },
  { value: 'role', description: '組織情報（role）', optional: true, defaultOn: false },
  { value: 'delegation_info', description: '委任情報（delegation_info）', optional: true, defaultOn: false },
]

type SessionData = {
  state: string
  nonce: string
  verifier?: string
  pkce: boolean
  scopeParam?: string
  user?: {
    idTokenClaims: JWTPayload
    userinfo: unknown
    tokenResponseScope: string
  }
}

const sessions = new Map<string, SessionData>()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const PAGE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    min-height: 100vh;
    background: #FAFAFA;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #242424;
    display: flex;
    justify-content: center;
  }
  .wrap { width: 100%; max-width: 640px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { font-size: 13px; color: #616161; margin: 0 0 20px; }
  .card {
    background: #FFFFFF;
    border-radius: 8px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.10), 0 0 2px rgba(0, 0, 0, 0.10);
    padding: 24px;
    margin-bottom: 16px;
  }
  .card h2 { font-size: 14px; margin: 0 0 12px; }
  .scope-row {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 6px 0; border-bottom: 1px solid #F3F2F1;
  }
  .scope-row:last-child { border-bottom: none; }
  .scope-row label { font-size: 13px; cursor: pointer; }
  .scope-row .scope-desc { color: #616161; font-size: 12px; display: block; }
  .toggle-row { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-top: 1px solid #EDEBE9; margin-top: 8px; }
  .toggle-row label { font-size: 13px; font-weight: 600; }
  .field { margin-top: 12px; }
  .field label { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 600; }
  input[type="text"] {
    width: 100%; height: 32px; padding: 0 10px; font-size: 14px; font-family: inherit;
    border: 1px solid #D1D1D1; border-radius: 4px;
  }
  button, .btn {
    display: inline-block; height: 32px; line-height: 32px; padding: 0 16px; margin-top: 16px;
    font-size: 14px; font-family: inherit; font-weight: 600; color: #FFFFFF; background: #0F6CBD;
    border: none; border-radius: 4px; cursor: pointer; text-decoration: none;
  }
  button:hover, .btn:hover { background: #115EA3; }
  .btn-secondary { background: #F3F2F1; color: #242424; }
  .btn-secondary:hover { background: #E8E6E4; }
  .badge {
    display: inline-block; background: #E8F0FE; color: #0F6CBD; border-radius: 10px;
    padding: 2px 8px; font-size: 11px; margin: 1px;
  }
  .badge-optional { background: #FFF4CE; color: #7A6400; }
  pre {
    background: #F3F2F1; border-radius: 4px; padding: 12px; font-size: 12px;
    overflow-x: auto; white-space: pre-wrap; word-break: break-all;
  }
  .muted { color: #8A8886; font-size: 12px; }
  .error { color: #D13438; }
`

function layout(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="wrap">${body}</div>
</body>
</html>`
}

function scopeBadges(scope: string[]): string {
  const optional = new Set(SCOPE_OPTIONS.filter((s) => s.optional).map((s) => s.value))
  return scope.map((s) => `<span class="badge${optional.has(s) ? ' badge-optional' : ''}">${escapeHtml(s)}</span>`).join(' ')
}

function formPage(): string {
  const rows = SCOPE_OPTIONS.map((s) => {
    const isOpenid = s.value === 'openid'
    return `
      <div class="scope-row">
        <input
          type="checkbox"
          id="scope-${s.value}"
          name="scope"
          value="${s.value}"
          ${s.defaultOn || isOpenid ? 'checked' : ''}
          ${isOpenid ? 'disabled' : ''}
        />
        <label for="scope-${s.value}">
          <code>${s.value}</code>${s.optional ? ' <span class="badge badge-optional">要事前申請</span>' : ''}
          <span class="scope-desc">${escapeHtml(s.description)}</span>
        </label>
      </div>`
  }).join('')

  return layout(
    'rp-sample',
    `
    <h1>rp-sample</h1>
    <p class="subtitle">nobizid（GBizIDダミーOP）に接続するテスト用RP。設定を変えて色々なOIDCパターンを試せます。</p>
    <form method="GET" action="/login">
      <div class="card">
        <h2>要求するscope</h2>
        ${rows}
        <div class="toggle-row">
          <input type="checkbox" id="omit_scope" name="omit_scope" value="on" />
          <label for="omit_scope">scopeパラメータ自体を送信しない（省略時の自動付与を確認）</label>
        </div>
      </div>
      <div class="card">
        <h2>認可リクエストの設定</h2>
        <div class="toggle-row">
          <input type="checkbox" id="pkce" name="pkce" value="on" checked />
          <label for="pkce">PKCEを使う（code_challenge / S256）</label>
        </div>
        <div class="field">
          <label for="login_hint">login_hint（任意・アカウントID事前入力）</label>
          <input type="text" id="login_hint" name="login_hint" placeholder="yamada" />
        </div>
      </div>
      <button type="submit">ログイン</button>
    </form>
    `,
  )
}

function successPage(session: SessionData): string {
  const user = session.user!
  return layout(
    'rp-sample - ログイン済み',
    `
    <h1>rp-sample</h1>
    <p class="subtitle">ログインに成功しました。</p>
    <div class="card">
      <h2>今回の設定</h2>
      <p>PKCE: ${session.pkce ? '✓ あり（S256）' : 'なし'}</p>
      <p>要求scope: ${session.scopeParam ? scopeBadges(session.scopeParam.split(' ')) : '<span class="muted">（送信しなかった＝自動付与）</span>'}</p>
      <p>token応答のscope: ${scopeBadges(user.tokenResponseScope.split(' ').filter(Boolean))}</p>
    </div>
    <div class="card">
      <h2>id_token のクレーム</h2>
      <p class="muted">GBizID仕様どおり、氏名・メールアドレス等の個人情報は含まれません。</p>
      <pre>${escapeHtml(JSON.stringify(user.idTokenClaims, null, 2))}</pre>
    </div>
    <div class="card">
      <h2>UserInfo のレスポンス</h2>
      <pre>${escapeHtml(JSON.stringify(user.userinfo, null, 2))}</pre>
    </div>
    <a class="btn" href="/logout">ログアウトして別の設定で試す</a>
    `,
  )
}

function errorPage(message: string): string {
  return layout(
    'rp-sample - エラー',
    `
    <h1>rp-sample</h1>
    <div class="card">
      <p class="error">${escapeHtml(message)}</p>
      <a class="btn btn-secondary" href="/">トップへ戻る</a>
    </div>
    `,
  )
}

const app = new Hono()

app.get('/', (c) => {
  const sid = getCookie(c, 'sid')
  const session = sid ? sessions.get(sid) : undefined
  if (session?.user) {
    return c.html(successPage(session))
  }
  return c.html(formPage())
})

app.get('/login', (c) => {
  const checkedScopes = c.req.queries('scope') ?? []
  const omitScope = c.req.query('omit_scope') === 'on'
  const pkce = c.req.query('pkce') === 'on'
  const loginHint = c.req.query('login_hint')?.trim()

  const state = randomBytes(16).toString('hex')
  const nonce = randomBytes(16).toString('hex')

  let verifier: string | undefined
  let challenge: string | undefined
  if (pkce) {
    verifier = randomBytes(32).toString('base64url')
    challenge = createHash('sha256').update(verifier).digest('base64url')
  }

  // The openid checkbox is disabled in the form (so it's never submitted);
  // make sure it's always present whenever a scope param is sent at all.
  const scopeParam = omitScope
    ? undefined
    : (checkedScopes.includes('openid') ? checkedScopes : ['openid', ...checkedScopes]).join(' ')

  const sid = randomUUID()
  sessions.set(sid, { state, nonce, verifier, pkce, scopeParam })
  setCookie(c, 'sid', sid, { httpOnly: true, path: '/', sameSite: 'Lax' })

  const url = new URL(AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  if (loginHint) url.searchParams.set('login_hint', loginHint)
  if (challenge) {
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  if (scopeParam) url.searchParams.set('scope', scopeParam)

  return c.redirect(url.toString(), 302)
})

app.get('/callback', async (c) => {
  const sid = getCookie(c, 'sid')
  const session = sid ? sessions.get(sid) : undefined
  if (!session) {
    return c.html(errorPage('セッションが見つかりません。トップからやり直してください。'), 400)
  }

  const authError = c.req.query('error')
  if (authError) {
    return c.html(
      errorPage(`authorizeがエラーを返しました: ${authError} (${c.req.query('error_description') ?? ''})`),
      400,
    )
  }

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || state !== session.state) {
    return c.html(errorPage('state が一致しません（CSRFの可能性、またはトップからやり直しが必要です）。'), 400)
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  })
  if (session.verifier) body.set('code_verifier', session.verifier)

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const tokenBody = (await tokenRes.json()) as Record<string, unknown>
  if (!tokenRes.ok) {
    return c.html(errorPage(`token endpointがエラーを返しました:\n${JSON.stringify(tokenBody, null, 2)}`), 502)
  }

  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(String(tokenBody.id_token), JWKS, { issuer: ISSUER, audience: CLIENT_ID }))
  } catch (err) {
    return c.html(errorPage(`id_tokenの検証に失敗しました: ${(err as Error).message}`), 400)
  }
  if (payload.nonce !== session.nonce) {
    return c.html(errorPage('nonce が一致しません。'), 400)
  }

  const userinfoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${String(tokenBody.access_token)}` },
  })
  const userinfo = await userinfoRes.json()

  session.user = {
    idTokenClaims: payload,
    userinfo,
    tokenResponseScope: String(tokenBody.scope ?? ''),
  }

  return c.redirect('/', 302)
})

app.get('/logout', (c) => {
  const sid = getCookie(c, 'sid')
  if (sid) sessions.delete(sid)
  deleteCookie(c, 'sid', { path: '/' })

  const url = new URL('/logout', OP_ORIGIN)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('logout_uri', LOGOUT_URI)
  return c.redirect(url.toString(), 302)
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`rp-sample listening on http://localhost:${info.port}`)
  console.log(`  -> nobizid issuer: ${ISSUER}`)
  console.log(`  -> redirect_uri: ${REDIRECT_URI}`)
})
