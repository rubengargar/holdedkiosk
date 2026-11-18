// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { Employee, TimeEntry } from './api'

type Kiosk = ReturnType<typeof import('./kiosk').useKiosk>

const MIN = 60_000
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
  failingActions: Set<string>
}

let world: World
let requests: Request[]
let useKiosk: typeof import('./kiosk').useKiosk
let mounted: { unmount: () => void }[]

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input)
  const method = init.method ?? 'GET'
  const token = new Headers(init.headers).get('X-Holded-API-Key') ?? ''
  requests.push({ method, path: url.pathname, token })

  if (world.badTokens.has(token)) return reply({ error: 'Holded request failed', detail: 'Unauthorized' }, 401)
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

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

function seedAccounts(...ids: string[]) {
  const accounts = ids.map(id => ({ id, name: `Empresa ${id}`, token: `token-${id}`, hiddenEmployeeIds: ['hidden'] }))
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
    failingActions: new Set()
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

    expect(take().sort()).toEqual(['GET /api/employees', 'GET /api/times'])
  })

  it('fetches only times on a poll tick', async () => {
    await mountKiosk()
    take()

    await vi.advanceTimersByTimeAsync(2 * MIN)

    expect(take()).toEqual(['GET /api/times'])
  })

  it('also fetches employees on a poll after 15 minutes', async () => {
    await mountKiosk()
    take()

    await vi.advanceTimersByTimeAsync(16 * MIN)
    const calls = take()

    expect(calls.filter(call => call === 'GET /api/employees')).toHaveLength(1)
    expect(calls.filter(call => call === 'GET /api/times')).toHaveLength(8)
  })

  it('fetches nothing when switching to a company loaded less than 30 seconds ago', async () => {
    seedAccounts('a', 'b')
    const kiosk = await mountKiosk()
    kiosk.setActive('b')
    await settle()
    expect(take()).toHaveLength(4)

    kiosk.setActive('a')
    await settle()
    kiosk.setActive('b')
    await settle()

    expect(take()).toEqual([])
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

    expect(take()).toEqual(['POST /api/employees/e1/clock-in', 'GET /api/times'])
    expect(kiosk.statuses.value.get('e1')?.runningSince).toBe(NOON - 60 * MIN)
  })

  it('does not poll while the page is hidden', async () => {
    await mountKiosk()
    take()

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(10 * MIN)

    expect(take()).toEqual([])
  })

  it('does not fetch times again on the poll right after becoming visible', async () => {
    await mountKiosk()
    take()

    await vi.advanceTimersByTimeAsync(2 * MIN - 1000)
    setVisibility('visible')
    await settle()
    expect(take()).toEqual(['GET /api/times'])

    await vi.advanceTimersByTimeAsync(1000)

    expect(take()).toEqual([])
  })

  it('drops a times response requested before a clock action finished', async () => {
    const kiosk = await mountKiosk()
    let release: (entries: TimeEntry[]) => void = () => {}
    world.times = () => new Promise<TimeEntry[]>(resolve => (release = resolve))
    await vi.advanceTimersByTimeAsync(2 * MIN)

    await vi.advanceTimersByTimeAsync(1000)
    await kiosk.clock(ANA, 'clock-in')
    release([])
    await settle()

    expect(kiosk.statuses.value.get('e1')?.runningSince).not.toBeNull()
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

    await vi.advanceTimersByTimeAsync(2 * MIN)

    expect(pausedOf(kiosk, 'e1')).toBe(true)
  })

  it('forgets the pause once the server shows no running entry', async () => {
    const kiosk = await mountKiosk()
    await kiosk.clock(ANA, 'pause')
    await vi.advanceTimersByTimeAsync(2 * MIN)

    world.times = () => [running('e1')]
    await vi.advanceTimersByTimeAsync(2 * MIN)

    expect(pausedOf(kiosk, 'e1')).toBe(false)
  })

  it('clears the pause on a successful unpause', async () => {
    const kiosk = await mountKiosk()
    world.times = () => [running('e1')]
    await kiosk.clock(ANA, 'pause')

    await kiosk.clock(ANA, 'unpause')
    await vi.advanceTimersByTimeAsync(2 * MIN)

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

  it('changes the token after one successful employees call and keeps the hidden list', async () => {
    const kiosk = await mountKiosk()
    take()
    world.employees = [ANA]

    await kiosk.changeToken('a', ' token-new ')

    expect(requests).toEqual([{ method: 'GET', path: '/api/employees', token: 'token-new' }])
    expect(kiosk.accounts.value[0]).toMatchObject({ token: 'token-new', hiddenEmployeeIds: ['hidden'] })
    expect(kiosk.activeState.value?.employees).toEqual([ANA])
  })

  it('keeps the old token when the new one is rejected', async () => {
    const kiosk = await mountKiosk()
    take()
    world.badTokens.add('token-bad')

    await expect(kiosk.changeToken('a', 'token-bad')).rejects.toThrow()

    expect(kiosk.accounts.value[0].token).toBe('token-a')
    expect(kiosk.activeState.value?.employees).toEqual([ANA, BEA])
    expect(take()).toEqual(['GET /api/employees'])
  })

  it('sets and removes the logo of one account only', async () => {
    seedAccounts('a', 'b')
    const kiosk = await mountKiosk()

    kiosk.setLogo('b', 'data:image/png;base64,AAAA')
    expect(kiosk.accounts.value.map(a => a.logo)).toEqual([undefined, 'data:image/png;base64,AAAA'])

    kiosk.setLogo('b', undefined)
    expect('logo' in kiosk.accounts.value[1]).toBe(false)
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
