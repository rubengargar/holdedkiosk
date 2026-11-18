// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { AccountInfo, Employee, TimeEntry } from './api'

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
  sealStatus: number
  failingActions: Set<string>
  info: AccountInfo
  infoStatus: number
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
  if (url.pathname === '/api/seal') {
    return world.sealStatus === 200
      ? reply({ token: `sealed.${token}`, employees: world.employees })
      : reply({ error: 'Sealing is not available on this Worker' }, world.sealStatus)
  }
  if (url.pathname === '/api/account') {
    return world.infoStatus === 200 ? reply(world.info) : reply({ error: 'Holded request failed', detail: 'Forbidden' }, world.infoStatus)
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
    infoStatus: 200
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
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
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
    expect(JSON.stringify(localStorage.getItem('kiosk_accounts'))).not.toContain('"key-new"')
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
