import type { Employee, TimeEntry } from './api'
import type { KeyValueStore } from './accounts'
import { dayStart } from './board'

export interface CachedState {
  employees: Employee[]
  entries: TimeEntry[]
  employeesFetchedAt: number | null
  timesFetchedAt: number | null
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

function parseCached(value: unknown, now: number): CachedState | null {
  if (!isRecord(value)) return null
  const { employees, entries, employeesFetchedAt, timesFetchedAt } = value
  if (!Array.isArray(employees) || !employees.every(isEmployee)) return null
  if (!Array.isArray(entries) || !entries.every(isEntry)) return null
  if (!isTime(employeesFetchedAt) || !isTime(timesFetchedAt)) return null
  const today = dayStart(now)
  return {
    employees,
    entries: entries.filter(entry => entry.end === null || entry.start >= today),
    employeesFetchedAt,
    timesFetchedAt
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
