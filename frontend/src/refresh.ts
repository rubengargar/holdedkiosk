import type { RateLimitInfo } from './api'

export const REFRESH_OPTIONS = [15, 30, 60, 0] as const
export type RefreshMinutes = (typeof REFRESH_OPTIONS)[number]

export const DEFAULT_REFRESH_MINUTES: RefreshMinutes = 30

const MIN = 60_000
export const IN_USE_MS = 2 * 60 * MIN
export const EMPLOYEES_TTL_MS = 24 * 60 * MIN
// With manual refresh nobody polls, so a touch after idle still refreshes data older than this.
const MANUAL_STALE_MS = 30 * MIN
// The kiosk checks once a minute; without slack a fetch that finished a second late would wait a whole extra minute.
const DUE_SLACK_MS = 10_000
const DEFAULT_BACKOFF_MS = 60_000

export const HOURS_IN_USE_PER_DAY = 10
export const WORKING_DAYS_PER_MONTH = 22

export function isRefreshMinutes(value: unknown): value is RefreshMinutes {
  return REFRESH_OPTIONS.some(option => option === value)
}

export function isInUse(visible: boolean, lastTouchAt: number | null, now: number): boolean {
  return visible && lastTouchAt != null && now - lastTouchAt < IN_USE_MS
}

export function isTimesDue(now: number, fetchedAt: number | null, refreshMinutes: RefreshMinutes): boolean {
  if (fetchedAt == null || fetchedAt > now) return true
  const staleAfter = refreshMinutes === 0 ? MANUAL_STALE_MS : refreshMinutes * MIN
  return now - fetchedAt >= staleAfter - DUE_SLACK_MS
}

export function isEmployeesDue(now: number, fetchedAt: number | null): boolean {
  return fetchedAt == null || fetchedAt > now || now - fetchedAt >= EMPLOYEES_TTL_MS
}

export interface MonthlyEstimate {
  times: number
  employees: number
}

export function estimateMonthlyCalls(refreshMinutes: RefreshMinutes): MonthlyEstimate {
  const perDay = refreshMinutes === 0 ? 0 : (60 / refreshMinutes) * HOURS_IN_USE_PER_DAY
  return { times: Math.round(perDay * WORKING_DAYS_PER_MONTH), employees: WORKING_DAYS_PER_MONTH }
}

export interface Block {
  quotaUntil: number | null
  backoffUntil: number | null
}

export const NO_BLOCK: Block = { quotaUntil: null, backoffUntil: null }

export function isBlocked(block: Block, now: number): boolean {
  return (block.quotaUntil ?? 0) > now || (block.backoffUntil ?? 0) > now
}

export function isQuotaExhausted(quotaUntil: number | null, now: number): boolean {
  return (quotaUntil ?? 0) > now
}

export function nextMonthStart(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
}

export function blockFromRateLimit(info: RateLimitInfo | null, now: number): Block {
  if (info?.window === 'month') {
    const reset = info.resetAtMs != null && info.resetAtMs > now ? info.resetAtMs : nextMonthStart(now)
    return { quotaUntil: reset, backoffUntil: null }
  }
  return { quotaUntil: null, backoffUntil: now + (info?.retryAfterMs ?? DEFAULT_BACKOFF_MS) }
}
