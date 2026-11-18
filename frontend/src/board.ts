import type { ClockAction, TimeEntry } from './api'

export interface EmployeeStatus {
  runningSince: number | null
  completedMs: number
  paused: boolean
}

export function dayStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function buildStatuses(entries: TimeEntry[], dayStartMs: number): Map<string, EmployeeStatus> {
  const statuses = new Map<string, EmployeeStatus>()

  for (const entry of entries) {
    let status = statuses.get(entry.employeeId)
    if (!status) {
      status = { runningSince: null, completedMs: 0, paused: false }
      statuses.set(entry.employeeId, status)
    }

    if (entry.end == null) {
      status.runningSince = entry.start
      status.paused = entry.paused
    } else if (entry.start >= dayStartMs) {
      status.completedMs += entry.end - entry.start
    }
  }

  return statuses
}

export function trackedMs(status: EmployeeStatus | undefined, now: number): number {
  if (!status) return 0
  const running = status.runningSince == null ? 0 : Math.max(0, now - Math.max(status.runningSince, dayStart(now)))
  return status.completedMs + running
}

export function mergePaused(
  statuses: Map<string, EmployeeStatus>,
  pausedIds: ReadonlySet<string>
): Map<string, EmployeeStatus> {
  const merged = new Map<string, EmployeeStatus>()
  for (const [id, status] of statuses) {
    const pausedHere = pausedIds.has(id) && status.runningSince != null
    merged.set(id, { ...status, paused: status.paused || pausedHere })
  }
  return merged
}

export function prunePaused(pausedIds: ReadonlySet<string>, entries: TimeEntry[]): Set<string> {
  const running = new Set(entries.filter(entry => entry.end == null).map(entry => entry.employeeId))
  return new Set([...pausedIds].filter(id => running.has(id)))
}

export function formatHHMM(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000)
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function applyClock(
  entries: TimeEntry[],
  employeeId: string,
  action: ClockAction,
  now: number
): TimeEntry[] {
  const isRunning = (entry: TimeEntry) => entry.employeeId === employeeId && entry.end == null

  if (action === 'clock-in') {
    return entries.some(isRunning) ? entries : [...entries, { employeeId, start: now, end: null, paused: false }]
  }

  return entries.map(entry => {
    if (!isRunning(entry)) return entry
    if (action === 'clock-out') return { ...entry, end: now, paused: false }
    return { ...entry, paused: action === 'pause' }
  })
}

export function isStaleTimes(requestedAt: number, lastActionAt: number | null): boolean {
  return lastActionAt != null && requestedAt <= lastActionAt
}

export function formatAge(fetchedAt: number | null, now: number): string {
  if (fetchedAt == null) return 'Sin datos todavía'
  const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (minutes < 1) return 'Actualizado ahora'
  if (minutes < 60) return `Actualizado hace ${minutes} min`
  if (minutes < 24 * 60) return `Actualizado hace ${Math.floor(minutes / 60)} h`
  return `Actualizado hace ${Math.floor(minutes / (24 * 60))} d`
}
