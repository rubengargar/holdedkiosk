import { describe, expect, it } from 'vitest'
import {
  blockFromRateLimit,
  estimateMonthlyCalls,
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
    [15, 880],
    [30, 440],
    [60, 220],
    [0, 0]
  ] as const)('estimates %s minutes as %s background calls plus 22 for the employee list', (minutes, times) => {
    expect(estimateMonthlyCalls(minutes)).toEqual({ times, employees: 22 })
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
    const block = blockFromRateLimit({ window: 'month', resetAtMs: T + 5 * HOUR, retryAfterMs: 1000 }, T)
    expect(block).toEqual({ quotaUntil: T + 5 * HOUR, backoffUntil: null })
  })

  it('blocks a month window until the next month without a usable reset', () => {
    expect(blockFromRateLimit({ window: 'month', resetAtMs: null, retryAfterMs: null }, T).quotaUntil).toBe(nextMonthStart(T))
    expect(blockFromRateLimit({ window: 'month', resetAtMs: T - 1, retryAfterMs: null }, T).quotaUntil).toBe(nextMonthStart(T))
  })

  it('backs off a minute window for Retry-After, defaulting to a minute', () => {
    expect(blockFromRateLimit({ window: 'minute', resetAtMs: null, retryAfterMs: 90_000 }, T).backoffUntil).toBe(T + 90_000)
    expect(blockFromRateLimit({ window: null, resetAtMs: null, retryAfterMs: null }, T).backoffUntil).toBe(T + MIN)
  })
})

describe('isBlocked', () => {
  it('is blocked while either deadline is in the future', () => {
    expect(isBlocked({ quotaUntil: T + 1, backoffUntil: null }, T)).toBe(true)
    expect(isBlocked({ quotaUntil: null, backoffUntil: T + 1 }, T)).toBe(true)
    expect(isBlocked({ quotaUntil: T, backoffUntil: null }, T)).toBe(false)
  })
})
