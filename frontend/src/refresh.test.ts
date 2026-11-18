import { describe, expect, it } from 'vitest'
import {
  blockFromError,
  blockFromRateLimit,
  employeesThatFit,
  estimateMonthlyCalls,
  intervalMs,
  PLAN_QUOTAS,
  isBlocked,
  isEmployeesDue,
  isInUse,
  isRefreshMinutes,
  isTimesDue,
  nextMonthStart
} from './refresh'

const MIN = 60_000
const HOUR = 60 * MIN
const T = new Date(2026, 5, 10, 12, 0, 0).getTime()

describe('isInUse', () => {
  it('needs a visible page and a touch within two hours', () => {
    expect(isInUse(true, T - HOUR, T)).toBe(true)
    expect(isInUse(true, T - 2 * HOUR, T)).toBe(false)
    expect(isInUse(true, null, T)).toBe(false)
    expect(isInUse(false, T, T)).toBe(false)
  })
})

describe('isTimesDue', () => {
  it('is due when never fetched or fetched in the future', () => {
    expect(isTimesDue(T, null, 30)).toBe(true)
    expect(isTimesDue(T, T + MIN, 30)).toBe(true)
  })

  it.each([
    [15, 14 * MIN, false],
    [15, 15 * MIN, true],
    [30, 29 * MIN, false],
    [30, 30 * MIN, true],
    [60, 59 * MIN, false],
    [60, 60 * MIN, true],
    [0, 29 * MIN, false],
    [0, 31 * MIN, true]
  ] as const)('with %s minutes and age %s the answer is %s (manual uses 30 minutes)', (minutes, age, due) => {
    expect(isTimesDue(T, T - age, minutes)).toBe(due)
  })
})

describe('isEmployeesDue', () => {
  it('is due after 24 hours only', () => {
    expect(isEmployeesDue(T, null)).toBe(true)
    expect(isEmployeesDue(T, T - 23 * HOUR)).toBe(false)
    expect(isEmployeesDue(T, T - 24 * HOUR)).toBe(true)
  })
})

describe('estimateMonthlyCalls', () => {
  it.each([
    [15, 1056],
    [30, 528],
    [60, 264],
    [0, 0]
  ] as const)('estimates %s minutes as %s background calls plus 22 for the employee list (12 polling hours a day)', (minutes, times) => {
    expect(estimateMonthlyCalls(minutes)).toEqual({ times, employees: 22 })
  })
})

describe('employeesThatFit', () => {
  it.each([
    [500, [0, 0, 2, 5]],
    [2_000, [10, 16, 19, 22]],
    [7_500, [72, 78, 81, 84]],
    [30_000, [328, 334, 337, 340]],
    [100_000, [1124, 1130, 1133, 1136]]
  ] as const)('a plan of %s calls fits %s employees at 15, 30, 60 minutes and manual', (plan, fits) => {
    expect([15, 30, 60, 0].map(minutes => employeesThatFit(plan, minutes as 15 | 30 | 60 | 0))).toEqual(fits)
  })

  it('lists the five plans', () => {
    expect(PLAN_QUOTAS).toEqual([500, 2000, 7500, 30000, 100000])
  })
})

describe('intervalMs', () => {
  it('is the refresh interval, or 30 minutes in manual mode', () => {
    expect([15, 30, 60, 0].map(m => intervalMs(m as 15 | 30 | 60 | 0))).toEqual([15 * MIN, 30 * MIN, 60 * MIN, 30 * MIN])
  })
})

describe('isRefreshMinutes', () => {
  it('accepts only the four options', () => {
    expect([0, 15, 30, 60].every(isRefreshMinutes)).toBe(true)
    expect([5, '30', null, undefined].some(isRefreshMinutes)).toBe(false)
  })
})

describe('blockFromRateLimit', () => {
  it('blocks a month window until the reset', () => {
    const block = blockFromRateLimit({ window: 'month', resetAtMs: T + 5 * HOUR, retryAfterMs: 1000 }, T, 30 * MIN)
    expect(block).toEqual({ quotaUntil: T + 5 * HOUR, backoffUntil: null })
  })

  it('blocks a month window until the next month without a usable reset', () => {
    const quotaUntil = (resetAtMs: number | null) =>
      blockFromRateLimit({ window: 'month', resetAtMs, retryAfterMs: null }, T, 30 * MIN).quotaUntil

    expect(quotaUntil(null)).toBe(nextMonthStart(T))
    expect(quotaUntil(T - 1)).toBe(nextMonthStart(T))
  })

  it('ignores a reset that is not epoch seconds in the next 32 days', () => {
    const quotaUntil = (resetSeconds: number) =>
      blockFromRateLimit({ window: 'month', resetAtMs: resetSeconds * 1000, retryAfterMs: null }, T, 30 * MIN).quotaUntil

    expect(quotaUntil(2_592_000)).toBe(nextMonthStart(T))
    expect(quotaUntil((T + 33 * 24 * HOUR) / 1000)).toBe(nextMonthStart(T))
    expect(quotaUntil(T)).toBe(nextMonthStart(T))
    expect(quotaUntil((T + 31 * 24 * HOUR) / 1000)).toBe(T + 31 * 24 * HOUR)
  })

  it('backs off a minute window for Retry-After, defaulting to a minute', () => {
    expect(blockFromRateLimit({ window: 'minute', resetAtMs: null, retryAfterMs: 90_000 }, T, 30 * MIN).backoffUntil).toBe(T + 90_000)
    expect(blockFromRateLimit({ window: null, resetAtMs: null, retryAfterMs: null }, T, 30 * MIN).backoffUntil).toBe(T + MIN)
  })

  it('backs off for the refresh interval when a window-less 429 repeats', () => {
    const info = { window: null, resetAtMs: null, retryAfterMs: 1000 }

    expect(blockFromRateLimit(info, T, 30 * MIN, true).backoffUntil).toBe(T + 30 * MIN)
  })
})

describe('blockFromError', () => {
  it('backs off for the interval without touching the quota', () => {
    expect(blockFromError(T, 15 * MIN)).toEqual({ quotaUntil: null, backoffUntil: T + 15 * MIN })
  })
})

describe('isBlocked', () => {
  it('is blocked while either deadline is in the future', () => {
    expect(isBlocked({ quotaUntil: T + 1, backoffUntil: null }, T)).toBe(true)
    expect(isBlocked({ quotaUntil: null, backoffUntil: T + 1 }, T)).toBe(true)
    expect(isBlocked({ quotaUntil: T, backoffUntil: null }, T)).toBe(false)
  })
})
