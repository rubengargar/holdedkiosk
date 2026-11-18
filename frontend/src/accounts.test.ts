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
    expect(accounts[0]).toMatchObject({ name: 'Empresa 1', token: 'tok-1', hiddenEmployeeIds: ['e1', 'e2'] })
    expect(store.getItem('kiosk_title')).toBe('Oficina Madrid')
    expect(store.getItem('holded_token')).toBeNull()
    expect(store.getItem('hidden_employee_ids')).toBeNull()
    expect(loadAccounts(store)).toEqual(accounts)
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
    const existing: Account = { id: 'x', name: 'Mi empresa', token: 'tok-1', hiddenEmployeeIds: [], refreshMinutes: 30 }
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
      { id: 'a', name: 'Uno', token: 't1', hiddenEmployeeIds: ['e1'], refreshMinutes: 15 },
      { id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [], refreshMinutes: 0 }
    ]

    saveAccounts(store, accounts)

    expect(loadAccounts(store)).toEqual(accounts)
  })

  it.each([[undefined], [null], ['https://app.holded.com/box/account/abc'], ['data:image/png;base64,AAAA']])(
    'round-trips the logo %s',
    logo => {
      const store = memoryStore()
      const account: Account = { id: 'a', name: 'Uno', token: 't1', hiddenEmployeeIds: [], logo, refreshMinutes: 60 }
      saveAccounts(store, [account])
      expect(loadAccounts(store)).toEqual([account])
    }
  )

  it('loads accounts stored without a logo', () => {
    const store = memoryStore()

    store.setItem('kiosk_accounts', JSON.stringify([{ id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [] }]))
    expect(loadAccounts(store)).toEqual([{ id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [], refreshMinutes: 30 }])
  })

  it.each([[undefined], [7], ['30'], [null]])('gives an account stored with refreshMinutes %s the default of 30', refreshMinutes => {
    const store = memoryStore()
    store.setItem('kiosk_accounts', JSON.stringify([{ id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [], refreshMinutes }]))

    expect(loadAccounts(store)[0].refreshMinutes).toBe(30)
  })

  it('restores the active account, falling back to the first one', () => {
    const store = memoryStore()
    const accounts: Account[] = [
      { id: 'a', name: 'Uno', token: 't1', hiddenEmployeeIds: [], refreshMinutes: 30 },
      { id: 'b', name: 'Dos', token: 't2', hiddenEmployeeIds: [], refreshMinutes: 0 }
    ]

    expect(loadActiveAccountId(store, accounts)).toBe('a')
    saveActiveAccountId(store, 'b')
    expect(loadActiveAccountId(store, accounts)).toBe('b')
    saveActiveAccountId(store, 'gone')
    expect(loadActiveAccountId(store, accounts)).toBe('a')
    expect(loadActiveAccountId(store, [])).toBeNull()
  })
})
