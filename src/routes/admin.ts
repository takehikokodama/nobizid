import { Hono } from 'hono'
import type { LoginHistoryEvent } from '../history.js'
import { getRecentLogins } from '../history.js'

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

function accountLabel(accountType: number, corpType: number): string {
  const account = { 1: 'gBizIDエントリー', 2: 'gBizIDプライム', 3: 'gBizIDメンバー' }[accountType] ?? `不明(${accountType})`
  const corp = { 1: '法人', 2: '個人事業主' }[corpType] ?? `不明(${corpType})`
  return `${account}・${corp}`
}

function scopeBadges(scope: string[]): string {
  const optional = new Set(['jp_gbizid_v1_ida', 'role', 'delegation_info'])
  return scope
    .map((s) => `<span class="badge${optional.has(s) ? ' badge-optional' : ''}">${escapeHtml(s)}</span>`)
    .join(' ')
}

function tokenExchangeList(event: LoginHistoryEvent): string {
  if (event.tokenExchanges.length === 0) {
    return '<span class="muted">なし（コード未交換）</span>'
  }
  return `<ol class="sublist">${event.tokenExchanges
    .map(
      (t) =>
        `<li>${formatTime(t.at)} — <code>${t.grantType}</code> (${scopeBadges(t.scope)})</li>`,
    )
    .join('')}</ol>`
}

function userinfoCallList(event: LoginHistoryEvent): string {
  if (event.userinfoCalls.length === 0) {
    return '<span class="muted">なし</span>'
  }
  return `<ol class="sublist">${event.userinfoCalls
    .map((u) => `<li>${formatTime(u.at)} — ${scopeBadges(u.scope)}</li>`)
    .join('')}</ol>`
}

function renderPage(events: LoginHistoryEvent[], limit: number): string {
  const rows = events
    .map(
      (e) => `
      <tr>
        <td>${formatTime(e.loggedInAt)}</td>
        <td>
          <div>${escapeHtml(e.username)} <span class="muted">(sub: ${escapeHtml(e.sub)})</span></div>
          <div class="muted">${accountLabel(e.accountType, e.corpType)}</div>
        </td>
        <td>
          <div><code>${escapeHtml(e.clientId)}</code></div>
          <div class="muted">${escapeHtml(e.redirectUri)}</div>
        </td>
        <td>${scopeBadges(e.scope)}</td>
        <td>${e.pkce ? '✓ S256' : '<span class="muted">なし</span>'}</td>
        <td>${tokenExchangeList(e)}</td>
        <td>${userinfoCallList(e)}</td>
      </tr>`,
    )
    .join('')

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
  .subtitle { font-size: 13px; color: #616161; margin: 0 0 20px; }
  .panel {
    background: #FFFFFF;
    border-radius: 8px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.10), 0 0 2px rgba(0, 0, 0, 0.10);
    overflow-x: auto;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
  th, td { text-align: left; padding: 10px 12px; vertical-align: top; border-bottom: 1px solid #EDEBE9; }
  th { color: #616161; font-weight: 600; background: #F9F8F8; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  .muted { color: #8A8886; font-size: 12px; }
  code { background: #F3F2F1; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .badge {
    display: inline-block; background: #E8F0FE; color: #0F6CBD; border-radius: 10px;
    padding: 2px 8px; font-size: 11px; margin: 1px;
  }
  .badge-optional { background: #FFF4CE; color: #7A6400; }
  .sublist { margin: 0; padding-left: 16px; }
  .sublist li { margin-bottom: 2px; }
  .empty { padding: 40px; text-align: center; color: #8A8886; }
  .toolbar { margin: 16px 0 0; font-size: 12px; color: #616161; }
  .toolbar a { color: #0F6CBD; text-decoration: none; }
</style>
</head>
<body>
  <h1>nobizid ログイン履歴</h1>
  <p class="subtitle">直近${limit}件のログイン（authorize→ログイン成功）と、それに紐づくtoken交換・userinfo呼び出しを表示しています。認証なし・ローカル開発専用。</p>
  <div class="panel">
    ${
      events.length === 0
        ? '<div class="empty">まだログインがありません。/oauth/authorize からログインすると、ここに表示されます。</div>'
        : `<table>
      <thead>
        <tr>
          <th>日時</th>
          <th>ユーザー</th>
          <th>Client / Redirect URI</th>
          <th>要求scope</th>
          <th>PKCE</th>
          <th>token交換</th>
          <th>userinfo呼び出し</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
    }
  </div>
  <p class="toolbar">表示件数を変えるには <code>?limit=N</code> を付けてください（例: <a href="/admin/logins?limit=20">?limit=20</a>）。手動リロードしてください。</p>
</body>
</html>`
}

app.get('/admin/logins', (c) => {
  const limitParam = Number(c.req.query('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_LIMIT
  const events = getRecentLogins(limit)
  return c.html(renderPage(events, limit))
})

export default app
