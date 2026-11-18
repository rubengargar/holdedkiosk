import type { TimeEntry } from './api'

export interface EmployeeStatus {
  runningSince: number | null
  completedMs: number
}

export type ClockAction = 'clock-in' | 'clock-out'

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
      status = { runningSince: null, completedMs: 0 }
      statuses.set(entry.employeeId, status)
    }

    if (entry.end == null) {
      status.runningSince = entry.start
    } else if (entry.start >= dayStartMs) {
      status.completedMs += entry.end - entry.start
    }
  }

  return statuses
}

export function trackedMs(status: EmployeeStatus | undefined, now: number): number {
  if (!status) return 0
  const running = status.runningSince == null ? 0 : Math.max(0, now - status.runningSince)
  return status.completedMs + running
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
    return entries.some(isRunning) ? entries : [...entries, { employeeId, start: now, end: null }]
  }

  return entries.map(entry => (isRunning(entry) ? { ...entry, end: now } : entry))
}
