import { describe, expect, it } from 'vitest'
import type { TimeEntry } from './api'
import { applyClock, buildStatuses, dayStart, formatHHMM, isStaleTimes, mergePaused, prunePaused, trackedMs } from './board'

const MIN = 60_000
const HOUR = 60 * MIN
const NOON = new Date(2026, 5, 10, 12, 0, 0).getTime()
const START_OF_DAY = dayStart(NOON)

describe('dayStart', () => {
  it('returns local midnight', () => {
    expect(START_OF_DAY).toBe(new Date(2026, 5, 10, 0, 0, 0).getTime())
  })
})

describe('buildStatuses', () => {
  it('sums finished entries of the day per employee', () => {
    const entries: TimeEntry[] = [
      { employeeId: 'a', start: START_OF_DAY + 9 * HOUR, end: START_OF_DAY + 11 * HOUR, paused: false },
      { employeeId: 'a', start: START_OF_DAY + 11 * HOUR + 30 * MIN, end: START_OF_DAY + 12 * HOUR, paused: false },
      { employeeId: 'b', start: START_OF_DAY + 8 * HOUR, end: START_OF_DAY + 9 * HOUR, paused: false }
    ]
    const statuses = buildStatuses(entries, START_OF_DAY)

    expect(statuses.get('a')).toEqual({ runningSince: null, completedMs: 2.5 * HOUR, paused: false })
    expect(statuses.get('b')).toEqual({ runningSince: null, completedMs: HOUR, paused: false })
  })

  it('ignores finished entries from before the day', () => {
    const entries: TimeEntry[] = [
      { employeeId: 'a', start: START_OF_DAY - 3 * HOUR, end: START_OF_DAY - HOUR, paused: false }
    ]
    expect(buildStatuses(entries, START_OF_DAY).get('a')?.completedMs).toBe(0)
  })

  it('reports the start of a running entry', () => {
    const start = START_OF_DAY + 9 * HOUR
    const status = buildStatuses([{ employeeId: 'a', start, end: null, paused: false }], START_OF_DAY).get('a')

    expect(status).toEqual({ runningSince: start, completedMs: 0, paused: false })
    expect(trackedMs(status, start + 90 * MIN)).toBe(90 * MIN)
  })

  it('keeps a running entry that started yesterday', () => {
    const start = START_OF_DAY - 2 * HOUR
    const status = buildStatuses([{ employeeId: 'a', start, end: null, paused: false }], START_OF_DAY).get('a')

    expect(status?.runningSince).toBe(start)
  })
})

describe('trackedMs and formatHHMM', () => {
  it('adds completed time and the running span', () => {
    expect(trackedMs({ runningSince: NOON - HOUR, completedMs: 30 * MIN, paused: false }, NOON)).toBe(90 * MIN)
  })

  it('counts a running entry from the start of the day when it began before midnight', () => {
    const status = { runningSince: START_OF_DAY - 2 * HOUR, completedMs: 0, paused: false }

    expect(trackedMs(status, START_OF_DAY + 8 * HOUR)).toBe(8 * HOUR)
  })

  it('is zero without a status', () => {
    expect(trackedMs(undefined, NOON)).toBe(0)
  })

  it('formats hours and minutes, dropping seconds', () => {
    expect(formatHHMM(0)).toBe('00:00')
    expect(formatHHMM(65 * MIN + 59_000)).toBe('01:05')
    expect(formatHHMM(10 * HOUR + 7 * MIN)).toBe('10:07')
  })
})

describe('applyClock', () => {
  it('clocks in then out, keeping other employees untouched', () => {
    const other: TimeEntry = { employeeId: 'b', start: NOON - 2 * HOUR, end: null, paused: false }
    const done: TimeEntry = { employeeId: 'a', start: NOON - 5 * HOUR, end: NOON - 4 * HOUR, paused: false }
    const initial = [other, done]

    const clockedIn = applyClock(initial, 'a', 'clock-in', NOON)
    const afterIn = buildStatuses(clockedIn, START_OF_DAY)
    expect(afterIn.get('a')).toEqual({ runningSince: NOON, completedMs: HOUR, paused: false })
    expect(afterIn.get('b')).toEqual({ runningSince: NOON - 2 * HOUR, completedMs: 0, paused: false })

    const clockedOut = applyClock(clockedIn, 'a', 'clock-out', NOON + 30 * MIN)
    const afterOut = buildStatuses(clockedOut, START_OF_DAY)
    expect(afterOut.get('a')).toEqual({ runningSince: null, completedMs: HOUR + 30 * MIN, paused: false })
    expect(clockedOut).toContainEqual(other)
    expect(initial).toEqual([other, done])
  })

  it('does not start a second running entry for a clocked-in employee', () => {
    const entries: TimeEntry[] = [{ employeeId: 'a', start: NOON - HOUR, end: null, paused: false }]
    expect(applyClock(entries, 'a', 'clock-in', NOON)).toEqual(entries)
  })

  it('pauses and resumes the running entry without ending it', () => {
    const other: TimeEntry = { employeeId: 'b', start: NOON - 2 * HOUR, end: null, paused: false }
    const initial: TimeEntry[] = [{ employeeId: 'a', start: NOON - HOUR, end: null, paused: false }, other]

    const paused = applyClock(initial, 'a', 'pause', NOON)
    expect(buildStatuses(paused, START_OF_DAY).get('a')).toEqual({ runningSince: NOON - HOUR, completedMs: 0, paused: true })
    expect(paused).toContainEqual(other)
    expect(trackedMs(buildStatuses(paused, START_OF_DAY).get('a'), NOON + HOUR)).toBe(2 * HOUR)

    const resumed = applyClock(paused, 'a', 'unpause', NOON + HOUR)
    expect(buildStatuses(resumed, START_OF_DAY).get('a')?.paused).toBe(false)
    expect(initial[0].paused).toBe(false)
  })

  it('clears the paused flag on clock-out', () => {
    const entries: TimeEntry[] = [{ employeeId: 'a', start: NOON - HOUR, end: null, paused: true }]

    const status = buildStatuses(applyClock(entries, 'a', 'clock-out', NOON), START_OF_DAY).get('a')

    expect(status).toEqual({ runningSince: null, completedMs: HOUR, paused: false })
  })

  it('ignores pause for an employee who is not clocked in', () => {
    const entries: TimeEntry[] = [{ employeeId: 'a', start: NOON - 2 * HOUR, end: NOON - HOUR, paused: false }]
    expect(applyClock(entries, 'a', 'pause', NOON)).toEqual(entries)
  })
})

describe('buildStatuses paused', () => {
  it('reads the paused flag from the running entry only', () => {
    const entries: TimeEntry[] = [
      { employeeId: 'a', start: NOON - HOUR, end: null, paused: true },
      { employeeId: 'b', start: NOON - HOUR, end: null, paused: false }
    ]
    const statuses = buildStatuses(entries, START_OF_DAY)

    expect(statuses.get('a')?.paused).toBe(true)
    expect(statuses.get('b')?.paused).toBe(false)
  })
})

describe('isStaleTimes', () => {
  it('drops a response requested before the last local action finished', () => {
    expect(isStaleTimes(NOON - 1, NOON)).toBe(true)
    expect(isStaleTimes(NOON, NOON)).toBe(true)
  })

  it('keeps a response requested after the last local action', () => {
    expect(isStaleTimes(NOON + 1, NOON)).toBe(false)
  })

  it('keeps every response when no local action happened', () => {
    expect(isStaleTimes(NOON, null)).toBe(false)
  })
})

describe('mergePaused', () => {
  const running = (paused: boolean) => ({ runningSince: NOON - HOUR, completedMs: 0, paused })
  const idle = { runningSince: null, completedMs: HOUR, paused: false }

  it('shows paused when the server says so', () => {
    const merged = mergePaused(new Map([['a', running(true)]]), new Set())

    expect(merged.get('a')?.paused).toBe(true)
  })

  it('shows paused for a kiosk-paused id while the server still shows a running entry', () => {
    const merged = mergePaused(new Map([['a', running(false)]]), new Set(['a']))

    expect(merged.get('a')?.paused).toBe(true)
  })

  it('does not show paused for a kiosk-paused id without a running entry', () => {
    const merged = mergePaused(new Map([['a', idle]]), new Set(['a']))

    expect(merged.get('a')?.paused).toBe(false)
  })

  it('leaves other employees untouched', () => {
    const merged = mergePaused(new Map([['b', running(false)]]), new Set(['a']))

    expect(merged.get('b')?.paused).toBe(false)
  })
})

describe('prunePaused', () => {
  it('keeps only ids that still have a running entry', () => {
    const entries: TimeEntry[] = [
      { employeeId: 'a', start: NOON - HOUR, end: null, paused: false },
      { employeeId: 'b', start: NOON - 2 * HOUR, end: NOON - HOUR, paused: false }
    ]

    expect([...prunePaused(new Set(['a', 'b', 'c']), entries)]).toEqual(['a'])
  })
})
