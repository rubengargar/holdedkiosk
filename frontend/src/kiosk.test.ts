// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { AccountInfo, Employee, TimeEntry } from './api'
import { trackedMs } from './board'

type Kiosk = ReturnType<typeof import('./kiosk').useKiosk>

const MIN = 60_000
const HOUR = 60 * MIN
const NOON = new Date(2026, 5, 10, 12, 0, 0).getTime()
const ANA: Employee = { id: 'e1', name: 'Ana' }
const BEA: Employee = { id: 'e2', name: 'Bea' }
const running = (employeeId: string, paused = false): TimeEntry => ({
  employeeId,
  start: NOON - 60 * MIN,
  end: null,
  paused
})

interface Request {
  method: string
  path: string
  token: string
}

interface World {
  employees: Employee[]
  times: () => TimeEntry[] | Promise<TimeEntry[]>
  badTokens: Set<string>
  sealStatus: number
  failingActions: Set<string>
  info: AccountInfo
  infoStatus: number
  unavailable: boolean
  limit: { window: 'minute' | 'month'; retryAfter?: number; reset?: number } | null
}

let world: World
let requests: Request[]
let useKiosk: typeof import('./kiosk').useKiosk
let mounted: { unmount: () => void }[]

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input)
  const method = init.method ?? 'GET'
  const token = new Headers(init.headers).get('X-Holded-API-Key') ?? ''
  requests.push({ method, path: url.pathname, token })

  if (world.badTokens.has(token)) return reply({ error: 'Holded request failed', detail: 'Unauthorized' }, 401)
  if (world.unavailable && url.pathname !== '/api/seal') {
    return reply({ error: 'Sealing key is not available yet, try again in a minute' }, 503)
  }
  if (url.pathname === '/api/seal') {
    return world.sealStatus === 200
      ? reply({ token: `sealed.${token}`, employees: world.employees })
      : reply({ error: 'Sealing is not available on this Worker' }, world.sealStatus)
  }
  if (url.pathname === '/api/account') {
    return world.infoStatus === 200 ? reply(world.info) : reply({ error: 'Holded request failed', detail: 'Forbidden' }, world.infoStatus)
  }
  if (world.limit && method === 'GET' && (url.pathname === '/api/times' || url.pathname === '/api/employees')) {
    const { window, retryAfter, reset } = world.limit
    return reply({ error: 'Holded request failed', detail: 'Too many requests' }, 429, {
      'X-RateLimit-Window': window,
      ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) }),
      ...(reset === undefined ? {} : { 'X-RateLimit-Reset': String(reset) })
    })
  }
  if (method === 'POST') {
    const action = url.pathname.split('/').pop() ?? ''
    if (world.failingActions.has(action)) return reply({ error: 'Holded request failed', detail: 'Conflict' }, 400)
    return reply({ ok: true })
  }
  if (url.pathname === '/api/employees') return reply(world.employees)
  return reply(await world.times())
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key)
  }
}

const take = () => requests.splice(0).map(r => `${r.method} ${r.path}`)
const settle = () => vi.advanceTimersByTimeAsync(0)
const touch = () => document.dispatchEvent(new Event('pointerdown'))
const count = (calls: string[], call: string) => calls.filter(c => c === call).length
const TIMES = 'GET /api/times'
const EMPLOYEES = 'GET /api/employees'

// Advances in half-hour steps, touching the kiosk after each step so it stays in use.
async function advanceInUse(ms: number, step = 30 * MIN) {
  for (let left = ms; left > 0; left -= step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, left))
    touch()
  }
}

function setRefresh(refreshMinutes: number) {
  const stored = JSON.parse(localStorage.getItem('kiosk_accounts') ?? '[]') as object[]
  localStorage.setItem('kiosk_accounts', JSON.stringify(stored.map(a => ({ ...a, refreshMinutes }))))
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

function seedAccounts(...ids: string[]) {
  const accounts = ids.map(id => ({
    id,
    name: `Empresa ${id}`,
    token: `sealed.token-${id}`,
    hiddenEmployeeIds: ['hidden'],
    logo: null
  }))
  localStorage.setItem('kiosk_accounts', JSON.stringify(accounts))
}

async function mountKiosk(): Promise<Kiosk> {
  let kiosk!: Kiosk
  const wrapper = mount(
    defineComponent({
      setup() {
        kiosk = useKiosk()
        return () => h('div')
      }
    })
  )
  mounted.push(wrapper)
  await settle()
  return kiosk
}

const pausedOf = (kiosk: Kiosk, id: string) => kiosk.statuses.value.get(id)?.paused

beforeEach(async () => {
  vi.stubEnv('VITE_WORKER_BASE', 'https://worker.test')
  vi.resetModules()
  ;({ useKiosk } = await import('./kiosk'))
  vi.useFakeTimers({ now: NOON, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  world = {
    employees: [BEA, ANA],
    times: () => [],
    badTokens: new Set(),
    sealStatus: 200,
    failingActions: new Set(),
    info: { name: 'Acme Holded', logoUrl: 'https://app.holded.com/box/account/abc' },
    infoStatus: 200,
    unavailable: false,
    limit: null
  }
  requests = []
  mounted = []
  vi.stubGlobal('fetch', fakeFetch)
  vi.stubGlobal('localStorage', memoryStorage())
  setVisibility('visible')
  seedAccounts('a')
})

afterEach(() => {
  mounted.forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('call budget', () => {
  it('loads employees and times once on first load', async () => {
    await mountKiosk()

    expect(take().sort()).toEqual([EMPLOYEES, TIMES])
  })

  it('spends 16 times calls and no employees call in 8 hours of use at the default 30 minutes', async () => {
    await mountKiosk()
    take()
    touch()

    for (let hour = 1; hour <= 8; hour++) {
      await vi.advanceTimersByTimeAsync(HOUR)
      touch()
    }
    const calls = take()

    expect(count(calls, TIMES)).toBe(16)
    expect(count(calls, EMPLOYEES)).toBeLessThanOrEqual(1)
    expect(calls).toHaveLength(16)
  })

  it('refreshes every 15 minutes when the company asks for it', async () => {
    setRefresh(15)
    await mountKiosk()
    take()
    touch()

    await advanceInUse(HOUR)

    expect(count(take(), TIMES)).toBe(4)
  })

  it('makes no call once nobody has touched the kiosk for two hours, however long it stays visible', async () => {
    await mountKiosk()
    take()
    touch()
    await vi.advanceTimersByTimeAsync(2 * HOUR)
    take()

    await vi.advanceTimersByTimeAsync(72 * HOUR)

    expect(take()).toEqual([])
  })

  it('makes exactly one times call on the first touch after idle', async () => {
    await mountKiosk()
    take()
    touch()
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    take()

    touch()
    await settle()
    expect(take()).toEqual([TIMES])

    touch()
    touch()
    await settle()
    expect(take()).toEqual([])
  })

  it('makes no call on the first touch after idle when the data is still fresh', async () => {
    await mountKiosk()
    take()

    touch()
    await settle()

    expect(take()).toEqual([])
  })

  it('refreshes employees once after 24 hours', async () => {
    await mountKiosk()
    take()
    touch()

    await advanceInUse(25 * HOUR)
    const calls = take()

    expect(count(calls, EMPLOYEES)).toBe(1)
    expect(count(calls, TIMES)).toBe(50)
  })

  it('refreshes employees with the first touch after more than 24 hours idle, along with times', async () => {
    await mountKiosk()
    take()

    await vi.advanceTimersByTimeAsync(30 * HOUR)
    expect(take()).toEqual([])
    touch()
    await settle()

    expect(take().sort()).toEqual([EMPLOYEES, TIMES])
  })

  it('makes no background call in manual mode while in use, but still refreshes stale data on the first touch after idle', async () => {
    setRefresh(0)
    await mountKiosk()
    take()
    touch()

    await advanceInUse(5 * HOUR)
    expect(take()).toEqual([])

    await vi.advanceTimersByTimeAsync(3 * HOUR)
    touch()
    await settle()
    expect(take()).toEqual([TIMES])
  })

  it('fetches nothing when switching to a company loaded less than 30 minutes ago', async () => {
    seedAccounts('a', 'b')
    const kiosk = await mountKiosk()
    kiosk.setActive('b')
    await settle()
    expect(take()).toHaveLength(4)

    await vi.advanceTimersByTimeAsync(29 * MIN)
    kiosk.setActive('a')
    await settle()
    kiosk.setActive('b')
    await settle()

    expect(take()).toEqual([])
  })

  it('refreshes a company on switching to it only when its data is older than its interval', async () => {
    seedAccounts('a', 'b')
    const kiosk = await mountKiosk()
    kiosk.setActive('b')
    await settle()
    take()

    await vi.advanceTimersByTimeAsync(31 * MIN)
    kiosk.setActive('a')
    await settle()

    expect(take()).toEqual([TIMES])
  })

  it('does not refresh on becoming visible while the data is fresh', async () => {
    await mountKiosk()
    touch()
    take()

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(10 * MIN)
    setVisibility('visible')
    await settle()

    expect(take()).toEqual([])
  })

  it('refreshes once on becoming visible when the data is older than the interval and the kiosk is in use', async () => {
    await mountKiosk()
    touch()
    take()

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(45 * MIN)
    setVisibility('visible')
    await settle()

    expect(take()).toEqual([TIMES])
  })

  it('does not poll while the page is hidden', async () => {
    await mountKiosk()
    touch()
    take()

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(2 * HOUR - MIN)

    expect(take()).toEqual([])
  })

  it('makes no call across a day rollover and counts the running time from midnight', async () => {
    setRefresh(0)
    world.times = () => [{ ...running('e1'), start: NOON - 5 * HOUR }]
    const kiosk = await mountKiosk()
    take()

    await vi.advanceTimersByTimeAsync(13 * HOUR)

    expect(take()).toEqual([])
    expect(trackedMs(kiosk.statuses.value.get('e1'), kiosk.now.value)).toBe(HOUR)
  })

  it('sends one POST and no reads for a clock action', async () => {
    const kiosk = await mountKiosk()
    take()

    await kiosk.clock(ANA, 'clock-in')

    expect(take()).toEqual(['POST /api/employees/e1/clock-in'])
    expect(kiosk.statuses.value.get('e1')?.runningSince).not.toBeNull()
  })

  it('re-fetches times once after a failed clock action', async () => {
    const kiosk = await mountKiosk()
    take()
    world.failingActions.add('clock-in')
    world.times = () => [running('e1')]

    await kiosk.clock(ANA, 'clock-in')

    expect(take()).toEqual(['POST /api/employees/e1/clock-in', TIMES])
    expect(kiosk.statuses.value.get('e1')?.runningSince).toBe(NOON - 60 * MIN)
  })

  it('manual refresh reloads employees and times', async () => {
    const kiosk = await mountKiosk()
    take()

    kiosk.refresh()
    await settle()

    expect(take().sort()).toEqual([EMPLOYEES, TIMES])
  })

  it('drops a times response requested before a clock action finished', async () => {
    const kiosk = await mountKiosk()
    touch()
    let release: (entries: TimeEntry[]) => void = () => {}
    world.times = () => new Promise<TimeEntry[]>(resolve => (release = resolve))
    await vi.advanceTimersByTimeAsync(30 * MIN)

    await vi.advanceTimersByTimeAsync(1000)
    await kiosk.clock(ANA, 'clock-in')
    release([])
    await settle()

    expect(kiosk.statuses.value.get('e1')?.runningSince).not.toBeNull()
  })
})

describe('persisted state', () => {
  const stored = () => JSON.parse(localStorage.getItem('kiosk_state') ?? 'null') as Record<string, unknown> | null

  it('costs zero calls on a reload while the data is fresh', async () => {
    await mountKiosk()
    take()
    mounted.forEach(wrapper => wrapper.unmount())
    await vi.advanceTimersByTimeAsync(10 * MIN)

    const kiosk = await mountKiosk()
    touch()
    await settle()

    expect(take()).toEqual([])
    expect(kiosk.activeState.value?.employees).toEqual([ANA, BEA])
  })

  it('costs one times call and no employees call on a reload with stale times', async () => {
    await mountKiosk()
    take()
    mounted.forEach(wrapper => wrapper.unmount())
    await vi.advanceTimersByTimeAsync(40 * MIN)

    await mountKiosk()

    expect(take()).toEqual([TIMES])
  })

  it('keeps running entries across a reload', async () => {
    world.times = () => [running('e1')]
    await mountKiosk()
    mounted.forEach(wrapper => wrapper.unmount())

    const kiosk = await mountKiosk()

    expect(kiosk.statuses.value.get('e1')?.runningSince).toBe(NOON - 60 * MIN)
  })

  it('never writes a token into the state key', async () => {
    await mountKiosk()

    expect(Object.keys(stored() ?? {})).toEqual(['a'])
    expect(localStorage.getItem('kiosk_state')).not.toContain('sealed.')
  })

  it.each([
    ['not json', '{oops'],
    ['not an object', '[1,2]'],
    ['employees of the wrong type', JSON.stringify({ a: { employees: 'x', entries: [], employeesFetchedAt: NOON, timesFetchedAt: NOON } })],
    ['an entry without a start', JSON.stringify({ a: { employees: [], entries: [{ employeeId: 'e1', end: null, paused: false }], employeesFetchedAt: NOON, timesFetchedAt: NOON } })],
    ['a fetch time that is not a number', JSON.stringify({ a: { employees: [], entries: [], employeesFetchedAt: 'now', timesFetchedAt: NOON } })]
  ])('ignores persisted state that is malformed (%s) and loads fresh', async (_name, raw) => {
    localStorage.setItem('kiosk_state', raw)

    const kiosk = await mountKiosk()

    expect(take().sort()).toEqual([EMPLOYEES, TIMES])
    expect(kiosk.activeState.value?.employees).toEqual([ANA, BEA])
  })

  it('removes the cached state of a deleted company and keeps the others', async () => {
    seedAccounts('a', 'b')
    const kiosk = await mountKiosk()
    kiosk.setActive('b')
    await settle()
    expect(Object.keys(stored() ?? {}).sort()).toEqual(['a', 'b'])

    kiosk.deleteAccount('b')

    expect(Object.keys(stored() ?? {})).toEqual(['a'])
  })
})

describe('quota', () => {
  const RESET = NOON + 3 * HOUR

  it('stops background refresh after a month-window 429 until the reset, shows the message, and still sends clock actions', async () => {
    const kiosk = await mountKiosk()
    touch()
    take()
    world.limit = { window: 'month', reset: RESET / 1000 }

    await vi.advanceTimersByTimeAsync(30 * MIN)
    expect(take()).toEqual([TIMES])
    expect(kiosk.quotaMessage.value).toContain('cuota mensual')
    expect(kiosk.quotaMessage.value).toContain('app de Holded')
    expect(kiosk.activeState.value?.error).toBe('')

    await advanceInUse(90 * MIN)
    expect(take()).toEqual([])

    await kiosk.clock(ANA, 'clock-in')
    expect(take()).toEqual(['POST /api/employees/e1/clock-in'])

    world.limit = null
    await advanceInUse(70 * MIN)
    expect(count(take(), TIMES)).toBe(1)
    expect(kiosk.quotaMessage.value).toBe('')
  })

  it('falls back to the start of next month when the 429 has no reset header', async () => {
    const kiosk = await mountKiosk()
    touch()
    world.limit = { window: 'month' }
    await vi.advanceTimersByTimeAsync(30 * MIN)
    take()

    expect(kiosk.activeState.value?.quotaUntil).toBe(new Date(2026, 6, 1).getTime())
  })

  it('still tries once on a manual refresh while the quota is exhausted', async () => {
    const kiosk = await mountKiosk()
    touch()
    world.limit = { window: 'month', reset: RESET / 1000 }
    await vi.advanceTimersByTimeAsync(30 * MIN)
    take()

    kiosk.refresh()
    await settle()

    expect(take().sort()).toEqual([EMPLOYEES, TIMES])
    expect(kiosk.quotaMessage.value).toContain('cuota mensual')
  })

  it('does not follow a failed clock action with a times read while the quota is exhausted', async () => {
    const kiosk = await mountKiosk()
    touch()
    world.limit = { window: 'month', reset: RESET / 1000 }
    await vi.advanceTimersByTimeAsync(30 * MIN)
    take()
    world.failingActions.add('clock-in')

    await kiosk.clock(ANA, 'clock-in')

    expect(take()).toEqual(['POST /api/employees/e1/clock-in'])
  })

  it('backs off for Retry-After after a minute-window 429 and shows the temporary message', async () => {
    const kiosk = await mountKiosk()
    touch()
    take()
    world.limit = { window: 'minute', retryAfter: 150 }

    await vi.advanceTimersByTimeAsync(30 * MIN)
    expect(take()).toEqual([TIMES])
    expect(kiosk.activeState.value?.error).toContain('limitando')
    expect(kiosk.quotaMessage.value).toBe('')

    world.limit = null
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(take()).toEqual([])

    await vi.advanceTimersByTimeAsync(MIN)
    expect(take()).toEqual([TIMES])
    expect(kiosk.activeState.value?.error).toBe('')
  })
})

describe('action errors', () => {
  it('keeps an action error through a sync until it is dismissed', async () => {
    const kiosk = await mountKiosk()
    world.failingActions.add('clock-in')
    await kiosk.clock(ANA, 'clock-in')

    kiosk.refresh()
    await settle()
    expect(kiosk.activeState.value?.actionError).toContain('Ana')

    kiosk.dismissActionError()
    expect(kiosk.activeState.value?.actionError).toBe('')
  })

  it('clears the action error when the next action starts', async () => {
    const kiosk = await mountKiosk()
    world.failingActions.add('clock-in')
    await kiosk.clock(ANA, 'clock-in')

    world.failingActions.clear()
    await kiosk.clock(ANA, 'clock-in')

    expect(kiosk.activeState.value?.actionError).toBe('')
  })

  it('does not report an action error through the sync error', async () => {
    const kiosk = await mountKiosk()
    world.failingActions.add('clock-in')

    await kiosk.clock(ANA, 'clock-in')

    expect(kiosk.activeState.value?.error).toBe('')
  })
})

describe('paused state', () => {
  it('stays paused across a poll while the server still shows a running entry', async () => {
    const kiosk = await mountKiosk()
    world.times = () => [running('e1')]
    await kiosk.clock(ANA, 'pause')

    await vi.advanceTimersByTimeAsync(1000)
    kiosk.refresh()
    await settle()

    expect(pausedOf(kiosk, 'e1')).toBe(true)
  })

  it('forgets the pause once the server shows no running entry', async () => {
    const kiosk = await mountKiosk()
    await kiosk.clock(ANA, 'pause')
    await vi.advanceTimersByTimeAsync(1000)
    kiosk.refresh()
    await settle()

    world.times = () => [running('e1')]
    await vi.advanceTimersByTimeAsync(1000)
    kiosk.refresh()
    await settle()

    expect(pausedOf(kiosk, 'e1')).toBe(false)
  })

  it('clears the pause on a successful unpause', async () => {
    const kiosk = await mountKiosk()
    world.times = () => [running('e1')]
    await kiosk.clock(ANA, 'pause')

    await kiosk.clock(ANA, 'unpause')
    await vi.advanceTimersByTimeAsync(1000)
    kiosk.refresh()
    await settle()

    expect(pausedOf(kiosk, 'e1')).toBe(false)
  })

  it('clears the pause when an unpause fails, so the row cannot get stuck on Reanudar', async () => {
    const kiosk = await mountKiosk()
    world.times = () => [running('e1')]
    await kiosk.clock(ANA, 'pause')
    await vi.advanceTimersByTimeAsync(1000)

    world.failingActions.add('unpause')
    await kiosk.clock(ANA, 'unpause')

    expect(pausedOf(kiosk, 'e1')).toBe(false)
  })
})

describe('accounts', () => {
  it('has no state for an unknown active id and does not create one', async () => {
    const kiosk = await mountKiosk()

    kiosk.setActive('ghost')

    expect(kiosk.activeState.value).toBeNull()
  })

  it('changes the token, reloads employees and the day entries, and keeps the hidden list', async () => {
    const kiosk = await mountKiosk()
    take()
    world.employees = [ANA]

    await kiosk.changeToken('a', ' token-new ')

    expect(requests).toEqual([
      { method: 'POST', path: '/api/seal', token: 'token-new' },
      { method: 'GET', path: '/api/account', token: 'sealed.token-new' },
      { method: 'GET', path: '/api/times', token: 'sealed.token-new' }
    ])
    expect(kiosk.accounts.value[0]).toMatchObject({ token: 'sealed.token-new', hiddenEmployeeIds: ['hidden'] })
    expect(kiosk.activeState.value?.employees).toEqual([ANA])
  })

  it('keeps the old token when the new one is rejected', async () => {
    const kiosk = await mountKiosk()
    take()
    world.badTokens.add('token-bad')

    await expect(kiosk.changeToken('a', 'token-bad')).rejects.toThrow()

    expect(kiosk.accounts.value[0].token).toBe('sealed.token-a')
    expect(kiosk.activeState.value?.employees).toEqual([ANA, BEA])
    expect(take()).toEqual(['POST /api/seal'])
  })

  it('switches to the next account when the active one is deleted', async () => {
    seedAccounts('a', 'b', 'c')
    const kiosk = await mountKiosk()
    kiosk.setActive('b')

    kiosk.deleteAccount('b')
    expect(kiosk.activeId.value).toBe('c')

    kiosk.deleteAccount('c')
    expect(kiosk.activeId.value).toBe('a')

    kiosk.deleteAccount('a')
    expect(kiosk.activeId.value).toBeNull()
  })
})

describe('company data from Holded', () => {
  const infoCalls = () => requests.filter(r => r.path === '/api/account')

  function seedLegacyAccount(name = 'Empresa 1') {
    localStorage.setItem(
      'kiosk_accounts',
      JSON.stringify([{ id: 'a', name, token: 'sealed.token-a', hiddenEmployeeIds: [] }])
    )
  }

  it('asks once when an account is added and stores the logo and the name', async () => {
    const kiosk = await mountKiosk()
    take()

    await kiosk.addAccount('', 'token-new')
    await settle()

    expect(infoCalls()).toHaveLength(1)
    expect(kiosk.accounts.value[1]).toMatchObject({
      name: 'Acme Holded',
      logo: 'https://app.holded.com/box/account/abc'
    })
  })

  it('still adds the account with logo null when the call fails', async () => {
    const kiosk = await mountKiosk()
    world.infoStatus = 403

    await kiosk.addAccount('', 'token-new')
    await settle()

    expect(kiosk.accounts.value).toHaveLength(2)
    expect(kiosk.accounts.value[1]).toMatchObject({ name: 'Empresa 2', logo: null })
    expect(kiosk.activeId.value).toBe(kiosk.accounts.value[1].id)
  })

  it('keeps a typed name over the Holded name', async () => {
    const kiosk = await mountKiosk()

    await kiosk.addAccount('  Mi empresa ', 'token-new')

    expect(kiosk.accounts.value[1].name).toBe('Mi empresa')
  })

  it('stores null when Holded has no logo, and does not ask again', async () => {
    const kiosk = await mountKiosk()
    world.info = { name: 'Acme Holded', logoUrl: null }
    await kiosk.addAccount('', 'token-new')
    take()

    kiosk.setActive('a')
    kiosk.setActive(kiosk.accounts.value[1].id)
    await settle()

    expect(kiosk.accounts.value[1].logo).toBeNull()
    expect(infoCalls()).toHaveLength(0)
  })

  it('asks once when the token is changed', async () => {
    const kiosk = await mountKiosk()
    take()

    await kiosk.changeToken('a', 'token-new')

    expect(infoCalls()).toEqual([{ method: 'GET', path: '/api/account', token: 'sealed.token-new' }])
    expect(kiosk.accounts.value[0].logo).toBe('https://app.holded.com/box/account/abc')
  })

  it('keeps the logo when the call fails on a token change', async () => {
    seedAccounts('a')
    const stored = JSON.parse(localStorage.getItem('kiosk_accounts') ?? '[]')
    stored[0].logo = 'https://app.holded.com/old'
    localStorage.setItem('kiosk_accounts', JSON.stringify(stored))
    const kiosk = await mountKiosk()
    world.infoStatus = 403

    await kiosk.changeToken('a', 'token-new')

    expect(kiosk.accounts.value[0]).toMatchObject({ token: 'sealed.token-new', logo: 'https://app.holded.com/old' })
  })

  it('asks lazily once for an account whose logo was never requested, and never on polls', async () => {
    seedLegacyAccount()

    const kiosk = await mountKiosk()
    expect(infoCalls()).toHaveLength(1)
    expect(kiosk.accounts.value[0].logo).toBe('https://app.holded.com/box/account/abc')

    take()
    touch()
    await advanceInUse(2 * HOUR)
    expect(take()).not.toContain('GET /api/account')
  })

  it('does not ask again after a failed lazy call', async () => {
    seedLegacyAccount()
    world.infoStatus = 403

    const kiosk = await mountKiosk()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    setVisibility('hidden')
    setVisibility('visible')
    await settle()

    expect(infoCalls()).toHaveLength(1)
    expect(kiosk.accounts.value[0].logo).toBeNull()
  })

  it('does not ask for an account that already has a logo or null', async () => {
    await mountKiosk()

    expect(infoCalls()).toHaveLength(0)
  })

  it('renames an auto-generated name on lazy load but never a typed one', async () => {
    seedLegacyAccount('Empresa 1')
    const auto = await mountKiosk()
    expect(auto.accounts.value[0].name).toBe('Acme Holded')

    mounted.forEach(wrapper => wrapper.unmount())
    seedLegacyAccount('Panadería Ruiz')
    const typed = await mountKiosk()
    expect(typed.accounts.value[0].name).toBe('Panadería Ruiz')
  })

  it('refreshes only the logo from the settings button when the name was typed', async () => {
    const kiosk = await mountKiosk()
    kiosk.renameAccount('a', 'Panadería Ruiz')
    take()

    expect(await kiosk.refreshInfo('a')).toBe(true)

    expect(take()).toEqual(['GET /api/account'])
    expect(kiosk.accounts.value[0]).toMatchObject({
      name: 'Panadería Ruiz',
      logo: 'https://app.holded.com/box/account/abc'
    })
  })

  it('refreshes an auto-generated name from the settings button', async () => {
    seedAccounts('a')
    localStorage.setItem(
      'kiosk_accounts',
      JSON.stringify([{ id: 'a', name: 'Empresa 3', token: 'sealed.token-a', hiddenEmployeeIds: [], logo: null }])
    )
    const kiosk = await mountKiosk()

    await kiosk.refreshInfo('a')

    expect(kiosk.accounts.value[0].name).toBe('Acme Holded')
  })

  it('reports a failed refresh and keeps what the account had', async () => {
    const kiosk = await mountKiosk()
    world.infoStatus = 403

    expect(await kiosk.refreshInfo('a')).toBe(false)
    expect(kiosk.accounts.value[0]).toMatchObject({ name: 'Empresa a', logo: null })
  })
})

describe('sealed tokens', () => {
  const storedTokens = () =>
    (JSON.parse(localStorage.getItem('kiosk_accounts') ?? '[]') as { token: string }[]).map(a => a.token)

  function seedPlain(...ids: string[]) {
    localStorage.setItem(
      'kiosk_accounts',
      JSON.stringify(ids.map(id => ({ id, name: `Empresa ${id}`, token: `key-${id}`, hiddenEmployeeIds: [], logo: null })))
    )
  }

  it('adds a company with one seal, one account call and the usual first times call, and stores only the sealed token', async () => {
    const kiosk = await mountKiosk()
    take()

    await kiosk.addAccount('', 'key-new')
    await settle()

    expect(requests).toEqual([
      { method: 'POST', path: '/api/seal', token: 'key-new' },
      { method: 'GET', path: '/api/account', token: 'sealed.key-new' },
      { method: 'GET', path: '/api/times', token: 'sealed.key-new' }
    ])
    expect(storedTokens()).toEqual(['sealed.token-a', 'sealed.key-new'])
    expect(localStorage.getItem('kiosk_accounts')).not.toContain('"key-new"')
  })

  it('shows a 503 as a temporary problem, keeps the data and does not ask for the key again', async () => {
    const kiosk = await mountKiosk()
    world.unavailable = true

    kiosk.refresh()
    await settle()

    const state = kiosk.activeState.value
    expect(state?.error).toContain('inténtalo de nuevo en un minuto')
    expect(state?.error).not.toContain('Vuelve a introducir')
    expect(state?.employees).toEqual([ANA, BEA])
    expect(storedTokens()).toEqual(['sealed.token-a'])
  })

  it('does not add the company when sealing fails', async () => {
    const kiosk = await mountKiosk()
    world.badTokens.add('key-bad')

    await expect(kiosk.addAccount('', 'key-bad')).rejects.toThrow()

    expect(kiosk.accounts.value).toHaveLength(1)
    expect(storedTokens()).toEqual(['sealed.token-a'])
  })

  it('stores only the sealed token after a token change', async () => {
    const kiosk = await mountKiosk()

    await kiosk.changeToken('a', 'key-new')

    expect(storedTokens()).toEqual(['sealed.key-new'])
  })

  describe('migrating a stored plain key', () => {
    it('seals each legacy account once, replaces the key and primes the employees, so one employees call per account', async () => {
      seedPlain('a', 'b')

      const kiosk = await mountKiosk()

      expect(requests.filter(r => r.path === '/api/seal')).toEqual([
        { method: 'POST', path: '/api/seal', token: 'key-a' },
        { method: 'POST', path: '/api/seal', token: 'key-b' }
      ])
      expect(requests.filter(r => r.path === '/api/employees')).toEqual([])
      expect(storedTokens()).toEqual(['sealed.key-a', 'sealed.key-b'])
      expect(kiosk.activeState.value?.employees).toEqual([ANA, BEA])
      expect(requests.filter(r => r.path === '/api/times')).toEqual([
        { method: 'GET', path: '/api/times', token: 'sealed.key-a' }
      ])
    })

    it('keeps the account working with its plain key when sealing fails, without retrying on polls', async () => {
      seedPlain('a')
      world.sealStatus = 503

      const kiosk = await mountKiosk()
      await vi.advanceTimersByTimeAsync(16 * MIN)
      setVisibility('hidden')
      setVisibility('visible')
      await settle()

      expect(requests.filter(r => r.path === '/api/seal')).toHaveLength(1)
      expect(storedTokens()).toEqual(['key-a'])
      expect(kiosk.activeState.value?.employees).toEqual([ANA, BEA])
      expect(requests.filter(r => r.path === '/api/employees').every(r => r.token === 'key-a')).toBe(true)
    })

    it('retries sealing on the next load', async () => {
      seedPlain('a')
      world.sealStatus = 503
      await mountKiosk()
      mounted.forEach(wrapper => wrapper.unmount())
      requests = []
      world.sealStatus = 200

      await mountKiosk()

      expect(storedTokens()).toEqual(['sealed.key-a'])
      expect(requests.filter(r => r.path === '/api/seal')).toHaveLength(1)
    })

    it('does not touch sealed accounts', async () => {
      await mountKiosk()

      expect(requests.some(r => r.path === '/api/seal')).toBe(false)
    })

    it('keeps going when one account is rejected', async () => {
      seedPlain('a', 'b')
      world.badTokens.add('key-a')

      await mountKiosk()

      expect(storedTokens()).toEqual(['key-a', 'sealed.key-b'])
    })
  })
})
