import { describe, expect, it } from 'vitest'
import type { TimeEntry } from './api'
import { applyClock, buildStatuses, dayStart, formatHHMM, trackedMs } from './board'

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
      { employeeId: 'a', start: START_OF_DAY + 9 * HOUR, end: START_OF_DAY + 11 * HOUR },
      { employeeId: 'a', start: START_OF_DAY + 11 * HOUR + 30 * MIN, end: START_OF_DAY + 12 * HOUR },
      { employeeId: 'b', start: START_OF_DAY + 8 * HOUR, end: START_OF_DAY + 9 * HOUR }
    ]
    const statuses = buildStatuses(entries, START_OF_DAY)

    expect(statuses.get('a')).toEqual({ runningSince: null, completedMs: 2.5 * HOUR })
    expect(statuses.get('b')).toEqual({ runningSince: null, completedMs: HOUR })
  })

  it('ignores finished entries from before the day', () => {
    const entries: TimeEntry[] = [
      { employeeId: 'a', start: START_OF_DAY - 3 * HOUR, end: START_OF_DAY - HOUR }
    ]
    expect(buildStatuses(entries, START_OF_DAY).get('a')?.completedMs).toBe(0)
  })

  it('reports the start of a running entry', () => {
    const start = START_OF_DAY + 9 * HOUR
    const status = buildStatuses([{ employeeId: 'a', start, end: null }], START_OF_DAY).get('a')

    expect(status).toEqual({ runningSince: start, completedMs: 0 })
    expect(trackedMs(status, start + 90 * MIN)).toBe(90 * MIN)
  })

  it('keeps a running entry that started yesterday', () => {
    const start = START_OF_DAY - 2 * HOUR
    const status = buildStatuses([{ employeeId: 'a', start, end: null }], START_OF_DAY).get('a')

    expect(status?.runningSince).toBe(start)
  })
})

describe('trackedMs and formatHHMM', () => {
  it('adds completed time and the running span', () => {
    expect(trackedMs({ runningSince: NOON - HOUR, completedMs: 30 * MIN }, NOON)).toBe(90 * MIN)
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
    const other: TimeEntry = { employeeId: 'b', start: NOON - 2 * HOUR, end: null }
    const done: TimeEntry = { employeeId: 'a', start: NOON - 5 * HOUR, end: NOON - 4 * HOUR }
    const initial = [other, done]

    const clockedIn = applyClock(initial, 'a', 'clock-in', NOON)
    const afterIn = buildStatuses(clockedIn, START_OF_DAY)
    expect(afterIn.get('a')).toEqual({ runningSince: NOON, completedMs: HOUR })
    expect(afterIn.get('b')).toEqual({ runningSince: NOON - 2 * HOUR, completedMs: 0 })

    const clockedOut = applyClock(clockedIn, 'a', 'clock-out', NOON + 30 * MIN)
    const afterOut = buildStatuses(clockedOut, START_OF_DAY)
    expect(afterOut.get('a')).toEqual({ runningSince: null, completedMs: HOUR + 30 * MIN })
    expect(clockedOut).toContainEqual(other)
    expect(initial).toEqual([other, done])
  })

  it('does not start a second running entry for a clocked-in employee', () => {
    const entries: TimeEntry[] = [{ employeeId: 'a', start: NOON - HOUR, end: null }]
    expect(applyClock(entries, 'a', 'clock-in', NOON)).toEqual(entries)
  })
})
