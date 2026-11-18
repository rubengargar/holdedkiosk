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
export const MAX_BACKOFF_MS = 24 * 60 * MIN
export const MAX_QUOTA_AHEAD_MS = 32 * 24 * 60 * MIN

export const HOURS_IN_USE_PER_DAY = 10
export const POLLING_HOURS_PER_DAY = HOURS_IN_USE_PER_DAY + IN_USE_MS / (60 * MIN)
export const WORKING_DAYS_PER_MONTH = 22
export const CALLS_PER_EMPLOYEE_PER_MONTH = 88
export const PLAN_QUOTAS = [500, 2_000, 7_500, 30_000, 100_000] as const

// How long a company waits after a failed read, and how often a healthy company polls.
export function intervalMs(refreshMinutes: RefreshMinutes): number {
  return refreshMinutes === 0 ? MANUAL_STALE_MS : refreshMinutes * MIN
}

export function isRefreshMinutes(value: unknown): value is RefreshMinutes {
  return REFRESH_OPTIONS.some(option => option === value)
}

export function isInUse(visible: boolean, lastTouchAt: number | null, now: number): boolean {
  return visible && lastTouchAt != null && now - lastTouchAt < IN_USE_MS
}

export function isTimesDue(now: number, fetchedAt: number | null, refreshMinutes: RefreshMinutes): boolean {
  if (fetchedAt == null || fetchedAt > now) return true
  return now - fetchedAt >= intervalMs(refreshMinutes) - DUE_SLACK_MS
}

export function isEmployeesDue(now: number, fetchedAt: number | null): boolean {
  return fetchedAt == null || fetchedAt > now || now - fetchedAt >= EMPLOYEES_TTL_MS
}

export interface MonthlyEstimate {
  times: number
  employees: number
}

// The kiosk keeps polling for IN_USE_MS after the last touch, so a day of touches spans more hours than it has hours of use.
export function estimateMonthlyCalls(refreshMinutes: RefreshMinutes): MonthlyEstimate {
  const perDay = refreshMinutes === 0 ? 0 : (60 / refreshMinutes) * POLLING_HOURS_PER_DAY
  return { times: Math.round(perDay * WORKING_DAYS_PER_MONTH), employees: WORKING_DAYS_PER_MONTH }
}

export function employeesThatFit(planCalls: number, refreshMinutes: RefreshMinutes): number {
  const { times, employees } = estimateMonthlyCalls(refreshMinutes)
  return Math.max(0, Math.floor((planCalls - times - employees) / CALLS_PER_EMPLOYEE_PER_MONTH))
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

// Holded's reset header is documented as epoch seconds, but anything outside the coming month is not trusted.
export function blockFromRateLimit(
  info: RateLimitInfo | null,
  now: number,
  interval: number,
  repeatedWithoutWindow = false
): Block {
  if (info?.window === 'month') {
    const reset =
      info.resetAtMs != null && info.resetAtMs > now && info.resetAtMs <= now + MAX_QUOTA_AHEAD_MS
        ? info.resetAtMs
        : nextMonthStart(now)
    return { quotaUntil: reset, backoffUntil: null }
  }
  const wait = repeatedWithoutWindow ? interval : Math.min(info?.retryAfterMs ?? DEFAULT_BACKOFF_MS, MAX_BACKOFF_MS)
  return { quotaUntil: null, backoffUntil: now + wait }
}

export function blockFromError(now: number, interval: number): Block {
  return { quotaUntil: null, backoffUntil: now + interval }
}
