// Shared between the login screen (authorize.ts) and the login history
// screen (admin.ts) so both describe an account_type/corp_type pair the
// same way.
export function accountLabel(accountType: number, corpType: number): string {
  const account = { 1: 'GビズIDエントリー', 2: 'GビズIDプライム', 3: 'GビズIDメンバー' }[accountType] ?? `不明(${accountType})`
  const corp = { 1: '法人', 2: '個人事業主' }[corpType] ?? `不明(${corpType})`
  return `${account}・${corp}`
}
