// In-memory record of recent logins, for the /admin/logins debug screen.
// A "login" is one successful POST /oauth/authorize. Everything that
// happens afterward for that same grant (token exchanges, refreshes,
// userinfo calls) is linked back to it via `loginId`, which is threaded
// through store.ts's GrantRecord.

export type TokenExchangeEvent = {
  at: number
  grantType: 'authorization_code' | 'refresh_token'
  scope: string[]
}

export type UserinfoCallEvent = {
  at: number
  scope: string[]
}

export type LoginHistoryEvent = {
  id: string
  loggedInAt: number
  username: string
  sub: string
  accountType: number
  corpType: number
  clientId: string
  redirectUri: string
  scope: string[]
  pkce: boolean
  state: string
  nonce: string
  tokenExchanges: TokenExchangeEvent[]
  userinfoCalls: UserinfoCallEvent[]
}

const MAX_HISTORY = 50

const history: LoginHistoryEvent[] = []
const byLoginId = new Map<string, LoginHistoryEvent>()

export function recordLogin(
  event: Omit<LoginHistoryEvent, 'tokenExchanges' | 'userinfoCalls'>,
): void {
  const full: LoginHistoryEvent = { ...event, tokenExchanges: [], userinfoCalls: [] }
  history.unshift(full)
  byLoginId.set(full.id, full)

  while (history.length > MAX_HISTORY) {
    const removed = history.pop()
    if (removed) byLoginId.delete(removed.id)
  }
}

export function recordTokenExchange(
  loginId: string,
  grantType: TokenExchangeEvent['grantType'],
  scope: string[],
): void {
  byLoginId.get(loginId)?.tokenExchanges.push({ at: Date.now(), grantType, scope })
}

export function recordUserinfoCall(loginId: string, scope: string[]): void {
  byLoginId.get(loginId)?.userinfoCalls.push({ at: Date.now(), scope })
}

export function getRecentLogins(limit: number): LoginHistoryEvent[] {
  return history.slice(0, limit)
}
