import { Hono } from 'hono'
import { accountLabel } from '../account-label.js'
import { CLIENT_ID, ISSUER } from '../config.js'
import * as sessions from '../sessions.js'
import type {
  AuthorizeGetEntry,
  AuthorizePostEntry,
  OidcSession,
  TimelineEntry,
  TokenPostEntry,
  UserinfoGetEntry,
} from '../sessions.js'
import { findUserBySub } from '../users.js'

const app = new Hono()

const DEFAULT_LIMIT = 5

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('ja-JP', { hour12: false })
}

function json(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2))
}

function scopeBadges(scope: string[] | null): string {
  if (!scope || scope.length === 0) return '<span class="muted">（なし）</span>'
  const optional = new Set(['jp_gbizid_v1_ida', 'role', 'delegation_info'])
  return scope
    .map((s) => `<span class="badge${optional.has(s) ? ' badge-optional' : ''}">${escapeHtml(s)}</span>`)
    .join(' ')
}

// --- timeline accessors -----------------------------------------------

function authorizeGet(session: OidcSession): AuthorizeGetEntry {
  return session.timeline[0] as AuthorizeGetEntry
}

function entriesOf<K extends TimelineEntry['kind']>(
  session: OidcSession,
  kind: K,
): Extract<TimelineEntry, { kind: K }>[] {
  return session.timeline.filter((e): e is Extract<TimelineEntry, { kind: K }> => e.kind === kind)
}

function lastSuccessfulAuthorizePost(session: OidcSession): AuthorizePostEntry | null {
  const posts = entriesOf(session, 'authorize_post')
  for (let i = posts.length - 1; i >= 0; i--) {
    if (posts[i].success) return posts[i]
  }
  return null
}

function lastSuccessfulTokenPost(session: OidcSession): TokenPostEntry | null {
  const posts = entriesOf(session, 'token_post')
  for (let i = posts.length - 1; i >= 0; i--) {
    if (posts[i].success) return posts[i]
  }
  return null
}

// --- status & consistency checks ---------------------------------------

type Status = 'success' | 'error' | 'pending'

function sessionStatus(session: OidcSession): Status {
  const get = authorizeGet(session)
  const hasError =
    get.error !== null ||
    entriesOf(session, 'token_post').some((e) => e.error !== null) ||
    entriesOf(session, 'userinfo_get').some((e) => e.error !== null)
  if (hasError) return 'error'
  if (entriesOf(session, 'token_post').some((e) => e.success)) return 'success'
  return 'pending'
}

const STATUS_LABEL: Record<Status, string> = { success: '成功', error: 'エラー', pending: '進行中' }

type CheckResult = { label: string; ok: boolean | null }

function computeChecks(session: OidcSession): CheckResult[] {
  const get = authorizeGet(session)
  const post = lastSuccessfulAuthorizePost(session)
  const tok = lastSuccessfulTokenPost(session)
  const pkceFailed = entriesOf(session, 'token_post').some((e) => e.error?.errorDescription?.includes('code_verifier'))
  const idClaims = tok?.idTokenClaims as { nonce?: unknown; aud?: unknown; iss?: unknown; exp?: number; iat?: number } | undefined

  return [
    { label: 'state一致', ok: post ? post.state === get.state : null },
    { label: 'nonce一致（ID Token内）', ok: idClaims ? idClaims.nonce === get.nonce : null },
    { label: 'PKCE検証', ok: !get.pkce ? null : tok ? true : pkceFailed ? false : null },
    { label: 'redirect_uri一致', ok: tok?.redirectUri ? tok.redirectUri === get.redirectUri : null },
    {
      label: 'id_token(aud/iss/exp)',
      ok: idClaims
        ? idClaims.aud === CLIENT_ID && idClaims.iss === ISSUER && (idClaims.exp ?? 0) > (idClaims.iat ?? 0)
        : null,
    },
  ]
}

function checkBadges(checks: CheckResult[]): string {
  return checks
    .map((c) => {
      const cls = c.ok === null ? 'check-na' : c.ok ? 'check-ok' : 'check-ng'
      const text = c.ok === null ? '対象外' : c.ok ? 'OK' : 'NG'
      return `<span class="check ${cls}">${escapeHtml(c.label)}: ${text}</span>`
    })
    .join(' ')
}

// --- timeline rendering --------------------------------------------------

function errorBanner(error: { error: string; errorDescription?: string } | null): string {
  if (!error) return ''
  return `<div class="step-error">error: <code>${escapeHtml(error.error)}</code>${
    error.errorDescription ? ` — ${escapeHtml(error.errorDescription)}` : ''
  }</div>`
}

function renderAuthorizeGet(e: AuthorizeGetEntry, index: number): string {
  return `
    <div class="step${e.error ? ' step-has-error' : ''}">
      <div class="step-head">#${index} ${formatTime(e.at)} — Authorization Request</div>
      <dl class="kv">
        <dt>client_id</dt><dd><code>${escapeHtml(e.clientId)}</code></dd>
        <dt>redirect_uri</dt><dd><code>${escapeHtml(e.redirectUri)}</code></dd>
        <dt>scope（RP送信値）</dt><dd>${e.scopeParamRaw ? escapeHtml(e.scopeParamRaw) : '<span class="muted">（省略＝自動付与）</span>'}</dd>
        <dt>scope（解決後）</dt><dd>${scopeBadges(e.resolvedScope)}</dd>
        <dt>state</dt><dd><code>${escapeHtml(e.state)}</code></dd>
        <dt>nonce</dt><dd><code>${escapeHtml(e.nonce)}</code></dd>
        <dt>PKCE</dt><dd>${e.pkce ? `✓ ${escapeHtml(e.codeChallengeMethod ?? '')}` : '<span class="muted">なし</span>'}</dd>
      </dl>
      ${errorBanner(e.error)}
    </div>`
}

function renderAuthorizePost(e: AuthorizePostEntry, index: number): string {
  return `
    <div class="step${!e.success ? ' step-has-error' : ''}">
      <div class="step-head">#${index} ${formatTime(e.at)} — ログイン試行${e.success ? '（成功）' : '（失敗）'}</div>
      <dl class="kv">
        <dt>アカウントID</dt><dd><code>${escapeHtml(e.username)}</code></dd>
        ${e.success ? `<dt>sub</dt><dd><code>${escapeHtml(e.sub ?? '')}</code></dd>` : ''}
        ${e.success ? `<dt>code</dt><dd><code>${escapeHtml(e.code ?? '')}</code></dd>` : ''}
      </dl>
      ${!e.success ? '<div class="step-error">アカウントIDまたはパスワードが違います</div>' : ''}
    </div>`
}

function renderTokenPost(e: TokenPostEntry, index: number): string {
  return `
    <div class="step${e.error ? ' step-has-error' : ''}">
      <div class="step-head">#${index} ${formatTime(e.at)} — Token Request/Response（<code>${escapeHtml(e.grantType)}</code>）</div>
      <dl class="kv">
        <dt>client認証方式</dt><dd><code>${escapeHtml(e.clientAuthMethod)}</code></dd>
        ${e.redirectUri ? `<dt>redirect_uri</dt><dd><code>${escapeHtml(e.redirectUri)}</code></dd>` : ''}
        <dt>code_verifier</dt><dd>${e.codeVerifierProvided ? '送信あり' : '<span class="muted">なし</span>'}</dd>
        ${e.scope ? `<dt>scope</dt><dd>${scopeBadges(e.scope)}</dd>` : ''}
        ${e.success ? `<dt>refresh_token</dt><dd>${e.hasRefreshToken ? '発行あり' : '<span class="muted">なし</span>'}</dd>` : ''}
      </dl>
      ${
        e.idTokenClaims
          ? `<div class="substep-label">id_token クレーム</div><pre>${json(e.idTokenClaims)}</pre>`
          : ''
      }
      ${
        e.accessTokenClaims
          ? `<div class="substep-label">access_token クレーム</div><pre>${json(e.accessTokenClaims)}</pre>`
          : ''
      }
      ${errorBanner(e.error)}
    </div>`
}

function renderUserinfoGet(e: UserinfoGetEntry, index: number): string {
  return `
    <div class="step${e.error ? ' step-has-error' : ''}">
      <div class="step-head">#${index} ${formatTime(e.at)} — UserInfo Request/Response</div>
      <dl class="kv">
        <dt>要求scope（トークンの付与scope）</dt><dd>${scopeBadges(e.scope)}</dd>
      </dl>
      ${e.claims ? `<div class="substep-label">レスポンス</div><pre>${json(e.claims)}</pre>` : ''}
      ${errorBanner(e.error)}
    </div>`
}

function renderTimeline(session: OidcSession): string {
  return session.timeline
    .map((e, i) => {
      const index = i + 1
      switch (e.kind) {
        case 'authorize_get':
          return renderAuthorizeGet(e, index)
        case 'authorize_post':
          return renderAuthorizePost(e, index)
        case 'token_post':
          return renderTokenPost(e, index)
        case 'userinfo_get':
          return renderUserinfoGet(e, index)
      }
    })
    .join('')
}

function renderDiscoveryNote(session: OidcSession): string {
  const lastFetch = sessions.getLastDiscoveryFetch()
  const get = authorizeGet(session)
  if (lastFetch === null) {
    return '<p class="muted">サーバー起動後、Discovery（/.well-known/openid-configuration）の取得は観測されていません。</p>'
  }
  if (lastFetch < get.at) {
    return `<p class="muted">直近のDiscovery取得: ${formatTime(lastFetch)}（このセッションのAuthorization Requestより前。特定のRPやセッションに確実に紐づくものではない参考情報です）</p>`
  }
  return '<p class="muted">このセッションのAuthorization Request以前にDiscovery取得は観測されていません（キャッシュ済み、または別セッション用に取得された可能性があります）。</p>'
}

function renderSummary(session: OidcSession): string {
  const get = authorizeGet(session)
  const status = sessionStatus(session)
  const last = session.timeline[session.timeline.length - 1]
  const duration = ((last.at - get.at) / 1000).toFixed(1)
  const hasTokenPost = entriesOf(session, 'token_post').length > 0
  return `
    <dl class="kv summary-kv">
      <dt>所要時間</dt><dd>${duration}秒</dd>
      <dt>client_id</dt><dd><code>${escapeHtml(get.clientId)}</code></dd>
      <dt>最終結果</dt><dd><span class="status status-${status}">${STATUS_LABEL[status]}</span></dd>
      <dt>client認証方式</dt><dd>${hasTokenPost ? '<code>client_secret_basic</code>' : '<span class="muted">（token交換なし）</span>'}</dd>
      <dt>PKCE</dt><dd>${get.pkce ? `✓ ${escapeHtml(get.codeChallengeMethod ?? '')}` : '<span class="muted">なし</span>'}</dd>
    </dl>`
}

function renderDetail(session: OidcSession): string {
  return `
    ${renderDiscoveryNote(session)}
    ${renderSummary(session)}
    <div class="checks">${checkBadges(computeChecks(session))}</div>
    <div class="timeline">${renderTimeline(session)}</div>`
}

function userLabelFor(session: OidcSession): string {
  const post = lastSuccessfulAuthorizePost(session)
  if (!post) {
    const attempts = entriesOf(session, 'authorize_post')
    const last = attempts[attempts.length - 1]
    return last ? `${escapeHtml(last.username)} <span class="muted">（未ログイン）</span>` : '<span class="muted">（未ログイン）</span>'
  }
  const user = post.sub ? findUserBySub(post.sub) : null
  const label = user ? accountLabel(user.account_type, user.corp_type) : ''
  return `${escapeHtml(post.username)} <span class="muted">(sub: ${escapeHtml(post.sub ?? '')})</span>${
    label ? `<div class="muted">${escapeHtml(label)}</div>` : ''
  }`
}

function renderRow(session: OidcSession): string {
  const get = authorizeGet(session)
  const status = sessionStatus(session)
  return `
  <details class="session">
    <summary>
      <div class="row-grid">
        <div>${formatTime(get.at)}</div>
        <div>${userLabelFor(session)}</div>
        <div>
          <div><code>${escapeHtml(get.clientId)}</code></div>
          <div class="muted">${escapeHtml(get.redirectUri)}</div>
        </div>
        <div>${scopeBadges(get.resolvedScope)}</div>
        <div>${get.pkce ? '✓' : '<span class="muted">なし</span>'}</div>
        <div><span class="status status-${status}">${STATUS_LABEL[status]}</span></div>
      </div>
    </summary>
    <div class="detail">${renderDetail(session)}</div>
  </details>`
}

function renderPage(sessionList: OidcSession[], limit: number): string {
  const rows = sessionList.map(renderRow).join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>nobizid ログイン履歴</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    background: #FAFAFA;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #242424;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 13px; color: #616161; margin: 0 0 4px; }
  .note { font-size: 12px; color: #8A8886; margin: 0 0 20px; }
  .panel {
    background: #FFFFFF;
    border-radius: 8px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.10), 0 0 2px rgba(0, 0, 0, 0.10);
    overflow-x: auto;
  }
  .row-grid {
    display: grid;
    grid-template-columns: 150px 190px minmax(200px, 1fr) minmax(160px, 1fr) 70px 90px;
    gap: 12px;
    align-items: start;
    font-size: 13px;
  }
  .col-header {
    padding: 10px 16px;
    color: #616161; font-weight: 600; background: #F9F8F8;
    border-bottom: 1px solid #EDEBE9;
    white-space: nowrap;
  }
  details.session { border-bottom: 1px solid #EDEBE9; }
  details.session:last-of-type { border-bottom: none; }
  details.session summary {
    padding: 10px 16px;
    cursor: pointer;
    list-style: none;
  }
  details.session summary::-webkit-details-marker { display: none; }
  details.session summary:hover { background: #F9F8F8; }
  details.session[open] summary { background: #F3F2F1; }
  .detail { padding: 16px; background: #FCFCFC; border-top: 1px solid #EDEBE9; font-size: 13px; }
  .muted { color: #8A8886; font-size: 12px; }
  code { background: #F3F2F1; padding: 1px 4px; border-radius: 3px; font-size: 12px; word-break: break-all; }
  .badge {
    display: inline-block; background: #E8F0FE; color: #0F6CBD; border-radius: 10px;
    padding: 2px 8px; font-size: 11px; margin: 1px;
  }
  .badge-optional { background: #FFF4CE; color: #7A6400; }
  .status { display: inline-block; border-radius: 10px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  .status-success { background: #DFF6DD; color: #0F7B0F; }
  .status-error { background: #FDE7E9; color: #D13438; }
  .status-pending { background: #F3F2F1; color: #616161; }
  .check { display: inline-block; border-radius: 10px; padding: 2px 10px; font-size: 12px; margin: 2px 4px 2px 0; }
  .check-ok { background: #DFF6DD; color: #0F7B0F; }
  .check-ng { background: #FDE7E9; color: #D13438; font-weight: 600; }
  .check-na { background: #F3F2F1; color: #8A8886; }
  .checks { margin: 12px 0; }
  .summary-kv { margin-bottom: 4px; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; margin: 8px 0; }
  .kv dt { color: #616161; }
  .kv dd { margin: 0; }
  .timeline { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
  .step { background: #FFFFFF; border: 1px solid #EDEBE9; border-left: 3px solid #D1D1D1; border-radius: 4px; padding: 10px 12px; }
  .step-has-error { border-left-color: #D13438; }
  .step-head { font-weight: 600; font-size: 12px; margin-bottom: 6px; }
  .step-error { color: #D13438; font-size: 12px; margin-top: 6px; }
  .substep-label { font-size: 11px; color: #616161; margin: 8px 0 2px; }
  pre {
    background: #F3F2F1; border-radius: 4px; padding: 8px 10px; font-size: 11px;
    overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 0;
  }
  .empty { padding: 40px; text-align: center; color: #8A8886; }
  .toolbar { margin: 16px 0 0; font-size: 12px; color: #616161; }
  .toolbar a { color: #0F6CBD; text-decoration: none; }
</style>
</head>
<body>
  <h1>nobizid ログイン履歴</h1>
  <p class="subtitle">直近${limit}件のセッション（Authorization Requestを起点に、ログイン試行・token交換・userinfo呼び出しまでを1件として記録）。行をクリックすると詳細が開きます。認証なし・手動リロード・ローカル開発専用。</p>
  <p class="note">整合性チェックの多くはnobizid自身が発行・検証する値の突き合わせのため、正常系では基本的にOKになります。RP側の実装確認は「どのパラメータが送られてきたか」「どのステップでエラーになったか」を見るのに使ってください。</p>
  <div class="panel">
    ${
      sessionList.length === 0
        ? '<div class="empty">まだセッションがありません。/oauth/authorize からログインすると、ここに表示されます。</div>'
        : `<div class="row-grid col-header">
        <div>日時</div>
        <div>ユーザー</div>
        <div>Client / Redirect URI</div>
        <div>要求scope</div>
        <div>PKCE</div>
        <div>結果</div>
      </div>
      ${rows}`
    }
  </div>
  <p class="toolbar">表示件数を変えるには <code>?limit=N</code> を付けてください（例: <a href="/admin/logins?limit=20">?limit=20</a>）。手動リロードしてください。</p>
</body>
</html>`
}

app.get('/admin/logins', (c) => {
  const limitParam = Number(c.req.query('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_LIMIT
  const sessionList = sessions.getRecentSessions(limit)
  return c.html(renderPage(sessionList, limit))
})

export default app
