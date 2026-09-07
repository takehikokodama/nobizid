import type { GbizIdUser } from './users.js'

export const BASE_SCOPES = ['openid', 'profile', 'user', 'mandate', 'email', 'offline_access'] as const
export const OPTIONAL_SCOPES = ['jp_gbizid_v1_ida', 'role', 'delegation_info'] as const

type ScopeError = 'invalid_scope'

/**
 * GBizID's current behavior: an omitted `scope` parameter is not "no scopes",
 * it silently expands to every base scope plus every optional scope the RP
 * has pre-arranged (this is documented as deprecated-but-current behavior).
 */
export function resolveAuthorizeScopes(
  scopeParam: string | undefined,
  grantedOptionalScopes: string[],
): string[] | ScopeError {
  if (!scopeParam || scopeParam.trim() === '') {
    return [...BASE_SCOPES, ...grantedOptionalScopes]
  }
  return validateScopeList(scopeParam, [...BASE_SCOPES, ...grantedOptionalScopes])
}

/**
 * On refresh, an omitted `scope` reuses the original grant's scope. When
 * present, it must be a subset of the original grant and must still include
 * "openid".
 */
export function resolveRefreshScopes(scopeParam: string | undefined, originalScopes: string[]): string[] | ScopeError {
  if (!scopeParam || scopeParam.trim() === '') {
    return originalScopes
  }
  return validateScopeList(scopeParam, originalScopes)
}

function validateScopeList(scopeParam: string, allowed: string[]): string[] | ScopeError {
  const requested = scopeParam.split(/\s+/).filter(Boolean)
  const allowedSet = new Set(allowed)
  if (requested.length === 0) return 'invalid_scope'
  if (!requested.includes('openid')) return 'invalid_scope'
  for (const s of requested) {
    if (!allowedSet.has(s)) return 'invalid_scope'
  }
  return requested
}

/**
 * Builds the UserInfo response by merging in only the fields unlocked by the
 * granted scopes. `profile`/`user` are stored as nested objects in
 * users.yaml for readability but GBizID returns their fields at the top
 * level, hence the spreads.
 */
export function buildUserInfoClaims(user: GbizIdUser, scopes: string[]): Record<string, unknown> {
  const claims: Record<string, unknown> = {}

  if (scopes.includes('openid')) {
    claims.sub = user.sub
  }
  if (scopes.includes('profile')) {
    claims.account_type = String(user.account_type)
    claims.corp_type = String(user.corp_type)
    if (user.account_type === 3 && user.parent_id) {
      claims.parent_id = user.parent_id
    }
    Object.assign(claims, user.profile ?? {})
  }
  if (scopes.includes('user')) {
    Object.assign(claims, user.user ?? {})
  }
  if (scopes.includes('mandate')) {
    claims.mandate_info = user.mandate_info ?? []
  }
  if (scopes.includes('email')) {
    claims.user_email = user.email
    claims.email = user.email
  }
  if (scopes.includes('jp_gbizid_v1_ida')) {
    claims.verified_claims = user.verified_claims ?? {}
  }
  if (scopes.includes('role')) {
    claims.role = user.role ?? {}
  }
  if (scopes.includes('delegation_info')) {
    claims.delegation_info = user.delegation_info ?? {}
  }

  return claims
}
