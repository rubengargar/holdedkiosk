export interface Account {
  id: string
  name: string
  token: string
  hiddenEmployeeIds: string[]
  logo?: string | null
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const ACCOUNTS_KEY = 'kiosk_accounts'
const ACTIVE_KEY = 'kiosk_active_account'
const LEGACY_TOKEN_KEY = 'holded_token'
const LEGACY_HIDDEN_KEY = 'hidden_employee_ids'

export function newAccountId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.token === 'string' &&
    Array.isArray(v.hiddenEmployeeIds) &&
    v.hiddenEmployeeIds.every(id => typeof id === 'string') &&
    (v.logo === undefined || v.logo === null || typeof v.logo === 'string')
  )
}

function readAccounts(store: KeyValueStore): Account[] {
  const parsed = parseJson(store.getItem(ACCOUNTS_KEY))
  return Array.isArray(parsed) ? parsed.filter(isAccount) : []
}

export function saveAccounts(store: KeyValueStore, accounts: Account[]): void {
  store.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function migrateLegacy(store: KeyValueStore): void {
  const token = store.getItem(LEGACY_TOKEN_KEY)?.trim()
  if (!token) return

  const accounts = readAccounts(store)
  if (!accounts.some(account => account.token === token)) {
    const hidden = parseJson(store.getItem(LEGACY_HIDDEN_KEY))
    accounts.push({
      id: newAccountId(),
      name: 'Empresa 1',
      token,
      hiddenEmployeeIds: Array.isArray(hidden) ? hidden.filter((id): id is string => typeof id === 'string') : []
    })
    saveAccounts(store, accounts)
  }

  store.removeItem(LEGACY_TOKEN_KEY)
  store.removeItem(LEGACY_HIDDEN_KEY)
}

export function loadAccounts(store: KeyValueStore): Account[] {
  migrateLegacy(store)
  return readAccounts(store)
}

export function loadActiveAccountId(store: KeyValueStore, accounts: Account[]): string | null {
  const stored = store.getItem(ACTIVE_KEY)
  const match = accounts.find(account => account.id === stored)
  return (match ?? accounts[0])?.id ?? null
}

export function saveActiveAccountId(store: KeyValueStore, id: string | null): void {
  if (id == null) store.removeItem(ACTIVE_KEY)
  else store.setItem(ACTIVE_KEY, id)
}
