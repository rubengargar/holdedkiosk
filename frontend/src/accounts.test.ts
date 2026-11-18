import { describe, expect, it } from 'vitest'
import {
  loadAccounts,
  loadActiveAccountId,
  saveAccounts,
  saveActiveAccountId,
  type Account,
  type KeyValueStore
} from './accounts'

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key)
  }
}

describe('legacy migration', () => {
  it('turns the legacy token and hidden ids into one account and removes the legacy keys', () => {
    const store = memoryStore({
      holded_token: 'tok-1',
      hidden_employee_ids: JSON.stringify(['e1', 'e2']),
      kiosk_title: 'Oficina Madrid'
    })

    const accounts = loadAccounts(store)

    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ name: 'Oficina Madrid', token: 'tok-1', hiddenEmployeeIds: ['e1', 'e2'] })
    expect(store.getItem('holded_token')).toBeNull()
    expect(store.getItem('hidden_employee_ids')).toBeNull()
    expect(loadAccounts(store)).toEqual(accounts)
  })

  it('names the account "Empresa 1" without a stored title', () => {
    const store = memoryStore({ holded_token: 'tok-1' })

    expect(loadAccounts(store)).toMatchObject([{ name: 'Empresa 1', hiddenEmployeeIds: [] }])
  })

  it('running twice changes nothing', () => {
    const store = memoryStore({ holded_token: 'tok-1' })

    const first = loadAccounts(store)
    const snapshot = new Map(store.data)
    const second = loadAccounts(store)

    expect(second).toEqual(first)
    expect(store.data).toEqual(snapshot)
  })

  it('does not duplicate an account whose token is already stored', () => {
    const existing: Account = { id: 'x', name: 'Mi empresa', token: 'tok-1', hiddenEmployeeIds: [] }
    const store = memoryStore({ kiosk_accounts: JSON.stringify([existing]), holded_token: 'tok-1' })

    expect(loadAccounts(store)).toEqual([existing])
    expect(store.getItem('holded_token')).toBeNull()
  })
})

describe('storage', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadAccounts(memoryStore())).toEqual([])
  })

  it('returns an empty list when the stored value is corrupt', () => {
    expect(loadAccounts(memoryStore({ kiosk_accounts: '{not json' }))).toEqual([])
  })

  it('round-trips accounts', () => {
    const store = memoryStore()
    const accounts: Account[] = [
      { id: 'a', name: 'Uno', token: 't1', hiddenEmployeeIds: ['e1'] },
      { id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [] }
    ]

    saveAccounts(store, accounts)

    expect(loadAccounts(store)).toEqual(accounts)
  })

  it('round-trips a logo and loads accounts stored without one', () => {
    const store = memoryStore()
    const withLogo: Account = { id: 'a', name: 'Uno', token: 't1', hiddenEmployeeIds: [], logo: 'data:image/png;base64,AAAA' }
    saveAccounts(store, [withLogo])
    expect(loadAccounts(store)).toEqual([withLogo])

    store.setItem('kiosk_accounts', JSON.stringify([{ id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [] }]))
    expect(loadAccounts(store)).toEqual([{ id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [] }])
  })

  it('restores the active account, falling back to the first one', () => {
    const store = memoryStore()
    const accounts: Account[] = [
      { id: 'a', name: 'Uno', token: 't1', hiddenEmployeeIds: [] },
      { id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [] }
    ]

    expect(loadActiveAccountId(store, accounts)).toBe('a')
    saveActiveAccountId(store, 'b')
    expect(loadActiveAccountId(store, accounts)).toBe('b')
    saveActiveAccountId(store, 'gone')
    expect(loadActiveAccountId(store, accounts)).toBe('a')
    expect(loadActiveAccountId(store, [])).toBeNull()
  })
})
