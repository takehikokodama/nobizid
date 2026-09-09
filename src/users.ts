import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { USERS_FILE } from './config.js'

export type AccountType = 1 | 2 | 3 // 1=gBizIDエントリー 2=gBizIDプライム 3=gBizIDメンバー
export type CorpType = 1 | 2 // 1=法人 2=個人事業主

export type MandateInfo = { client_id: string }

// profile / user / verified_claims / role / delegation_info are passed
// through to the UserInfo response as-is (see gbizid-dummy-op-spec.md for
// the exact shape GBizID expects per account type). We intentionally do not
// try to derive them from account_type/corp_type in code, since the real
// conditional rules are intricate; users.yaml ships one worked example per
// account type to copy from instead.
export type GbizIdUser = {
  username: string
  password: string
  sub: string
  account_type: AccountType
  corp_type: CorpType
  email: string
  // Free-text annotation shown next to the username on the login screen
  // (e.g. "GビズIDプライム・法人"). Falls back to an auto-generated label
  // from account_type/corp_type when omitted.
  label?: string
  parent_id?: string
  profile?: Record<string, unknown>
  user?: Record<string, unknown>
  mandate_info?: MandateInfo[]
  verified_claims?: Record<string, unknown>
  role?: Record<string, unknown>
  delegation_info?: Record<string, unknown>
}

const FALLBACK_USERS: GbizIdUser[] = [
  {
    username: 'operator',
    password: 'password',
    sub: '1',
    account_type: 2,
    corp_type: 1,
    label: 'GビズIDプライム・法人',
    email: 'operator@example.com',
    profile: {
      corporate_number: '1000000000001',
      name: '株式会社ダミー',
      en_name: '',
      prefecture_name: '13',
      address1: '東京都千代田区',
      address2: '',
      rep_last_nm: '山田',
      rep_first_nm: '太郎',
      rep_last_nm_kana: 'ヤマダ',
      rep_first_nm_kana: 'タロウ',
      birthday_ymd: '19800101',
    },
    user: {
      user_last_nm: '山田',
      user_first_nm: '太郎',
      user_last_nm_kana: 'ヤマダ',
      user_first_nm_kana: 'タロウ',
      user_post_code: '1000001',
      user_prefecture_name: '13',
      user_address1: '東京都千代田区',
      user_address2: '',
      user_address3: '',
      user_department: '',
      user_tel_no_contact: '',
      user_birthday_ymd: '19800101',
    },
    mandate_info: [],
    verified_claims: {
      verification: { trust_framework: 'jp_gbizid_v1', assurance_level: 'ial2' },
      claims: {},
    },
    role: {},
    delegation_info: {},
  },
  {
    username: 'admin',
    password: 'admin',
    sub: '2',
    account_type: 1,
    corp_type: 2,
    label: 'GビズIDエントリー・個人事業主',
    email: 'admin@example.com',
    profile: {
      corporate_number: '2000000000002',
      name: '個人事業主ダミー商店',
      en_name: '',
      prefecture_name: '13',
      address1: '東京都千代田区',
      address2: '',
      rep_last_nm: '鈴木',
      rep_first_nm: '花子',
      rep_last_nm_kana: 'スズキ',
      rep_first_nm_kana: 'ハナコ',
      birthday_ymd: '19850101',
    },
    user: {
      user_last_nm: '鈴木',
      user_first_nm: '花子',
      user_last_nm_kana: 'スズキ',
      user_first_nm_kana: 'ハナコ',
      user_post_code: '1000001',
      user_prefecture_name: '13',
      user_address1: '東京都千代田区',
      user_address2: '',
      user_address3: '',
      user_department: '',
      user_tel_no_contact: '',
      user_birthday_ymd: '19850101',
    },
    mandate_info: [],
    verified_claims: {
      verification: { trust_framework: 'jp_gbizid_v1', assurance_level: 'ial1' },
      claims: {},
    },
    role: {},
    delegation_info: {},
  },
]

function isValidUser(u: unknown): u is GbizIdUser {
  if (typeof u !== 'object' || u === null) return false
  const r = u as Record<string, unknown>
  return (
    typeof r.username === 'string' &&
    typeof r.password === 'string' &&
    typeof r.sub === 'string' &&
    (r.account_type === 1 || r.account_type === 2 || r.account_type === 3) &&
    (r.corp_type === 1 || r.corp_type === 2) &&
    typeof r.email === 'string'
  )
}

function loadUsers(): GbizIdUser[] {
  let raw: string
  try {
    raw = readFileSync(USERS_FILE, 'utf-8')
  } catch (err) {
    console.warn(`[users] could not read ${USERS_FILE}, falling back to built-in users: ${(err as Error).message}`)
    return FALLBACK_USERS
  }

  try {
    const parsed = parse(raw) as { users?: unknown }
    if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) {
      throw new Error('expected a top-level "users" array')
    }
    for (const u of parsed.users) {
      if (!isValidUser(u)) {
        throw new Error(
          `each user needs username/password/sub (string), account_type (1|2|3), corp_type (1|2), email (string): ${JSON.stringify(u)}`,
        )
      }
    }
    return parsed.users as GbizIdUser[]
  } catch (err) {
    console.warn(`[users] failed to parse ${USERS_FILE}, falling back to built-in users: ${(err as Error).message}`)
    return FALLBACK_USERS
  }
}

export const USERS = loadUsers()

export function verifyCredentials(username: string, password: string): GbizIdUser | null {
  return USERS.find((u) => u.username === username && u.password === password) ?? null
}

export function findUserBySub(sub: string): GbizIdUser | null {
  return USERS.find((u) => u.sub === sub) ?? null
}

export function listLoginHints(): Array<{ username: string; label?: string }> {
  return USERS.map((u) => ({ username: u.username, label: u.label }))
}
