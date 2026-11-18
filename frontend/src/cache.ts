import type { Employee, TimeEntry } from './api'
import type { KeyValueStore } from './accounts'
import { dayStart } from './board'
import { MAX_BACKOFF_MS, MAX_QUOTA_AHEAD_MS } from './refresh'

export interface CachedState {
  employees: Employee[]
  entries: TimeEntry[]
  employeesFetchedAt: number | null
  timesFetchedAt: number | null
  quotaUntil: number | null
  backoffUntil: number | null
}

export const STATE_KEY = 'kiosk_state'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTime = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))

const isEmployee = (value: unknown): value is Employee =>
  isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'

const isEntry = (value: unknown): value is TimeEntry =>
  isRecord(value) &&
  typeof value.employeeId === 'string' &&
  typeof value.start === 'number' &&
  Number.isFinite(value.start) &&
  (value.end === null || (typeof value.end === 'number' && Number.isFinite(value.end))) &&
  typeof value.paused === 'boolean'

// A time from a clock that has since gone backwards counts as not set.
const past = (time: number | null, now: number) => (time != null && time <= now ? time : null)

// A block already over, or implausibly far ahead (a clock that was wrong when it was saved), is dropped.
const upcoming = (time: number | null, now: number, maxAhead: number) =>
  time != null && time > now && time <= now + maxAhead ? time : null

function parseCached(value: unknown, now: number): CachedState | null {
  if (!isRecord(value)) return null
  const { employees, entries, employeesFetchedAt, timesFetchedAt, quotaUntil = null, backoffUntil = null } = value
  if (!Array.isArray(employees) || !employees.every(isEmployee)) return null
  if (!Array.isArray(entries) || !entries.every(isEntry)) return null
  if (!isTime(employeesFetchedAt) || !isTime(timesFetchedAt)) return null
  if (!isTime(quotaUntil) || !isTime(backoffUntil)) return null
  const today = dayStart(now)
  return {
    employees,
    entries: entries.filter(entry => entry.end === null || entry.start >= today),
    employeesFetchedAt: past(employeesFetchedAt, now),
    timesFetchedAt: past(timesFetchedAt, now),
    quotaUntil: upcoming(quotaUntil, now, MAX_QUOTA_AHEAD_MS),
    backoffUntil: upcoming(backoffUntil, now, MAX_BACKOFF_MS)
  }
}

export function loadCache(store: KeyValueStore, now: number): Record<string, CachedState> {
  let parsed: unknown
  try {
    parsed = JSON.parse(store.getItem(STATE_KEY) ?? 'null')
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  const cache: Record<string, CachedState> = {}
  for (const [id, value] of Object.entries(parsed)) {
    const state = parseCached(value, now)
    if (state) cache[id] = state
  }
  return cache
}

export function saveCache(store: KeyValueStore, cache: Record<string, CachedState>): void {
  try {
    store.setItem(STATE_KEY, JSON.stringify(cache))
  } catch {
    // A full or blocked store only costs a reload some calls; it must not break a sync.
  }
}
