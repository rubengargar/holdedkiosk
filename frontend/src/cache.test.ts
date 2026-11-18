import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from './accounts'
import { loadCache, saveCache, STATE_KEY } from './cache'

const NOON = new Date(2026, 5, 10, 12, 0, 0).getTime()
const HOUR = 3_600_000

function store(initial?: string): KeyValueStore {
  const items = new Map<string, string>(initial === undefined ? [] : [[STATE_KEY, initial]])
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: key => void items.delete(key)
  }
}

describe('cached state', () => {
  it('round-trips a company state', () => {
    const s = store()
    const state = {
      employees: [{ id: 'e1', name: 'Ana' }],
      entries: [{ employeeId: 'e1', start: NOON - HOUR, end: null, paused: false }],
      employeesFetchedAt: NOON,
      timesFetchedAt: NOON,
      quotaUntil: NOON + HOUR,
      backoffUntil: NOON + 30 * 60_000
    }

    saveCache(s, { a: state })

    expect(loadCache(s, NOON)).toEqual({ a: state })
  })

  it('discards entries from a past day but keeps running ones and today ones', () => {
    const yesterday = NOON - 20 * HOUR
    const s = store(
      JSON.stringify({
        a: {
          employees: [],
          entries: [
            { employeeId: 'e1', start: yesterday, end: yesterday + HOUR, paused: false },
            { employeeId: 'e2', start: yesterday, end: null, paused: false },
            { employeeId: 'e3', start: NOON - HOUR, end: NOON, paused: false }
          ],
          employeesFetchedAt: NOON,
          timesFetchedAt: NOON
        }
      })
    )

    expect(loadCache(s, NOON).a.entries.map(e => e.employeeId)).toEqual(['e2', 'e3'])
  })

  it('restores a block that is still ahead and drops one in the past or far in the future', () => {
    const base = { employees: [], entries: [], employeesFetchedAt: NOON, timesFetchedAt: NOON }
    const load = (quotaUntil: number | null, backoffUntil: number | null) =>
      loadCache(store(JSON.stringify({ a: { ...base, quotaUntil, backoffUntil } })), NOON).a

    expect(load(NOON + HOUR, NOON + HOUR)).toMatchObject({ quotaUntil: NOON + HOUR, backoffUntil: NOON + HOUR })
    expect(load(NOON - 1, NOON)).toMatchObject({ quotaUntil: null, backoffUntil: null })
    expect(load(NOON + 400 * 24 * HOUR, NOON + 400 * 24 * HOUR)).toMatchObject({ quotaUntil: null, backoffUntil: null })
  })

  it('loads state saved without a block, and rejects a block that is not a number', () => {
    const base = { employees: [], entries: [], employeesFetchedAt: NOON, timesFetchedAt: NOON }
    const s = store(JSON.stringify({ a: base, b: { ...base, quotaUntil: 'x' }, c: { ...base, backoffUntil: '5' } }))

    expect(loadCache(s, NOON).a).toMatchObject({ quotaUntil: null, backoffUntil: null })
    expect(Object.keys(loadCache(s, NOON))).toEqual(['a'])
  })

  it('treats a fetch time in the future as not set', () => {
    const s = store(JSON.stringify({ a: { employees: [], entries: [], employeesFetchedAt: NOON + HOUR, timesFetchedAt: NOON + HOUR } }))

    expect(loadCache(s, NOON).a).toMatchObject({ employeesFetchedAt: null, timesFetchedAt: null })
  })

  it('drops only the malformed company', () => {
    const good = { employees: [], entries: [], employeesFetchedAt: null, timesFetchedAt: null }
    const s = store(JSON.stringify({ a: good, b: { ...good, entries: [{ employeeId: 1 }] } }))

    expect(Object.keys(loadCache(s, NOON))).toEqual(['a'])
  })

  it('survives a store that throws on write', () => {
    const throwing: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }

    expect(() => saveCache(throwing, {})).not.toThrow()
  })
})
