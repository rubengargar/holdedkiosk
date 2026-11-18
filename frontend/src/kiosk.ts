import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  loadAccounts,
  loadActiveAccountId,
  newAccountId,
  saveAccounts,
  saveActiveAccountId,
  type Account
} from './accounts'
import { applyClock, buildStatuses, dayStart, isStaleTimes, mergePaused, prunePaused } from './board'
import { loadCache, saveCache, type CachedState } from './cache'
import {
  ApiError,
  clock as clockRequest,
  describeError,
  getAccountInfo,
  getEmployees,
  getTimes,
  SEALED_PREFIX,
  sealKey,
  type AccountInfo,
  type ClockAction,
  type Employee,
  type TimeEntry
} from './api'
import {
  blockFromError,
  blockFromRateLimit,
  DEFAULT_REFRESH_MINUTES,
  intervalMs,
  isBlocked,
  isEmployeesDue,
  isInUse,
  isQuotaExhausted,
  isTimesDue,
  NO_BLOCK,
  type RefreshMinutes
} from './refresh'

export interface AccountState {
  employees: Employee[]
  entries: TimeEntry[]
  employeesFetchedAt: number | null
  timesFetchedAt: number | null
  loading: boolean
  error: string
  actionError: string
  pausedIds: Set<string>
  clocking: Record<string, boolean>
  lastActionAt: number | null
  quotaUntil: number | null
  backoffUntil: number | null
  // When a Holded 429 without a window header was last seen, to tell a repeat from a second failure of the same attempt.
  windowlessAt: number | null
}

// 'tick' is the background timer, 'view' a page load, a switch or a first touch, 'manual' the Actualizar button.
type SyncMode = 'tick' | 'view' | 'manual'

const TICK_MS = 60_000
const AUTO_NAME = /^Empresa \d+$/

function emptyState(cached?: CachedState): AccountState {
  return {
    employees: cached?.employees ?? [],
    entries: cached?.entries ?? [],
    employeesFetchedAt: cached?.employeesFetchedAt ?? null,
    timesFetchedAt: cached?.timesFetchedAt ?? null,
    loading: false,
    error: '',
    actionError: '',
    pausedIds: new Set(),
    clocking: {},
    lastActionAt: null,
    quotaUntil: cached?.quotaUntil ?? null,
    backoffUntil: cached?.backoffUntil ?? null,
    windowlessAt: null
  }
}

export function quotaMessage(until: number): string {
  const date = new Date(until).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
  return `Se ha agotado la cuota mensual de llamadas a la API de Holded. Fichar desde el kiosko fallará hasta que se restablezca (${date}) o se amplíe el plan de Holded. Mientras tanto, se puede fichar desde la app de Holded.`
}

function sortByName(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchAccountInfo(token: string): Promise<AccountInfo | null> {
  try {
    return await getAccountInfo(token)
  } catch {
    return null
  }
}

export function useKiosk() {
  const accounts = ref<Account[]>(loadAccounts(localStorage))
  const activeId = ref<string | null>(loadActiveAccountId(localStorage, accounts.value))
  const states = reactive<Record<string, AccountState>>({})
  const cache = loadCache(localStorage, Date.now())
  for (const account of accounts.value) states[account.id] = emptyState(cache[account.id])
  const now = ref(Date.now())
  const infoRequested = new Set<string>()
  let lastTouchAt: number | null = null

  function persistStates() {
    const snapshot: Record<string, CachedState> = {}
    for (const account of accounts.value) {
      const state = states[account.id]
      if (!state) continue
      const hasData = state.employeesFetchedAt != null || state.timesFetchedAt != null
      if (!hasData && state.quotaUntil == null && state.backoffUntil == null) continue
      snapshot[account.id] = {
        employees: state.employees,
        entries: state.entries,
        employeesFetchedAt: state.employeesFetchedAt,
        timesFetchedAt: state.timesFetchedAt,
        quotaUntil: state.quotaUntil,
        backoffUntil: state.backoffUntil
      }
    }
    saveCache(localStorage, snapshot)
  }

  const activeAccount = computed(() => accounts.value.find(a => a.id === activeId.value) ?? null)
  const activeState = computed<AccountState | null>(() => (activeId.value ? states[activeId.value] ?? null : null))
  const activeQuotaMessage = computed(() => {
    const until = activeState.value?.quotaUntil ?? null
    return until != null && isQuotaExhausted(until, now.value) ? quotaMessage(until) : ''
  })
  const statuses = computed(() =>
    mergePaused(
      buildStatuses(activeState.value?.entries ?? [], dayStart(now.value)),
      activeState.value?.pausedIds ?? new Set()
    )
  )

  // A response fetched with a token that has since been replaced must not land.
  function tokenReplaced(account: Account): boolean {
    return accounts.value.find(a => a.id === account.id)?.token !== account.token
  }

  // A failed read waits one refresh interval before the next try, so a broken company costs no more than a healthy one.
  function noteFailure(account: Account, state: AccountState, e: unknown, attemptAt: number) {
    const at = Date.now()
    const interval = intervalMs(account.refreshMinutes)
    let block = blockFromError(at, interval)
    if (e instanceof ApiError && e.status === 429) {
      const windowless = e.message.startsWith('Holded request failed') && e.rateLimit?.window == null
      const repeated = windowless && state.windowlessAt != null && state.windowlessAt < attemptAt
      if (windowless) state.windowlessAt = at
      block = blockFromRateLimit(e.rateLimit, at, interval, repeated)
    }
    // Two reads of one attempt can fail differently. The longer wait wins.
    const pending = state.backoffUntil != null && state.backoffUntil > at ? state.backoffUntil : 0
    Object.assign(state, {
      ...block,
      backoffUntil: block.backoffUntil == null ? null : Math.max(block.backoffUntil, pending)
    })
  }

  function fail(account: Account, state: AccountState, e: unknown, attemptAt: number): false {
    if (tokenReplaced(account)) return false
    noteFailure(account, state, e, attemptAt)
    state.error = isQuotaExhausted(state.quotaUntil, Date.now()) ? '' : describeError(e)
    return false
  }

  function clearBlock(state: AccountState) {
    Object.assign(state, NO_BLOCK)
    state.windowlessAt = null
  }

  // Resolves to whether the read succeeded.
  async function loadTimes(account: Account, state: AccountState, at: number): Promise<boolean> {
    try {
      const entries = await getTimes(account.token, dayStart(at))
      if (tokenReplaced(account)) return false
      state.timesFetchedAt = Date.now()
      if (isStaleTimes(at, state.lastActionAt)) return true
      state.entries = entries
      state.pausedIds = prunePaused(state.pausedIds, entries)
      return true
    } catch (e) {
      return fail(account, state, e, at)
    }
  }

  async function sync(id: string, mode: SyncMode) {
    const account = accounts.value.find(a => a.id === id)
    if (!account) return
    const state = states[id]
    if (!state || state.loading) return

    const at = Date.now()
    if (state.lastActionAt != null && state.lastActionAt > at) state.lastActionAt = null
    if (mode !== 'manual' && isBlocked(state, at)) return
    const needEmployees = mode === 'manual' || isEmployeesDue(at, state.employeesFetchedAt)
    const needTimes = mode === 'manual' || isTimesDue(at, state.timesFetchedAt, account.refreshMinutes)
    if (!needEmployees && !needTimes) return

    if (mode !== 'tick' && account.logo === undefined) void refreshInfo(id)

    state.loading = true
    state.error = ''

    const loadEmployees = async () => {
      try {
        const employees = sortByName(await getEmployees(account.token))
        if (tokenReplaced(account)) return false
        state.employees = employees
        state.employeesFetchedAt = Date.now()
        return true
      } catch (e) {
        return fail(account, state, e, at)
      }
    }

    const results = await Promise.all([
      needEmployees ? loadEmployees() : true,
      needTimes ? loadTimes(account, state, at) : true
    ])
    if (results.every(Boolean)) clearBlock(state)
    state.loading = false
    persistStates()
  }

  function syncActive(mode: SyncMode) {
    if (activeId.value) void sync(activeId.value, mode)
  }

  function applyInfo(id: string, info: AccountInfo | null) {
    accounts.value = accounts.value.map(a => {
      if (a.id !== id) return a
      const name = info?.name.trim()
      return {
        ...a,
        logo: info ? info.logoUrl : (a.logo ?? null),
        name: name && AUTO_NAME.test(a.name) ? name : a.name
      }
    })
  }

  async function refreshInfo(id: string): Promise<boolean> {
    const account = accounts.value.find(a => a.id === id)
    if (!account || infoRequested.has(id)) return false
    infoRequested.add(id)
    try {
      const info = await fetchAccountInfo(account.token)
      applyInfo(id, info)
      return info !== null
    } finally {
      infoRequested.delete(id)
    }
  }

  async function addAccount(name: string, key: string) {
    const { token, employees } = await sealKey(key)
    const info = await fetchAccountInfo(token)
    const holdedName = info?.name.trim()
    const account: Account = {
      id: newAccountId(),
      name: name.trim() || holdedName || `Empresa ${accounts.value.length + 1}`,
      token,
      hiddenEmployeeIds: [],
      logo: info ? info.logoUrl : null,
      refreshMinutes: DEFAULT_REFRESH_MINUTES
    }
    states[account.id] = {
      ...emptyState(),
      employees: sortByName(employees),
      employeesFetchedAt: Date.now()
    }
    accounts.value = [...accounts.value, account]
    persistStates()
    activeId.value = account.id
  }

  async function changeToken(id: string, key: string) {
    const { token, employees } = await sealKey(key.trim())
    const info = await fetchAccountInfo(token)
    accounts.value = accounts.value.map(a => (a.id === id ? { ...a, token } : a))
    applyInfo(id, info)
    const state = states[id]
    if (state) {
      state.employees = sortByName(employees)
      state.employeesFetchedAt = Date.now()
      state.entries = []
      state.timesFetchedAt = null
      state.error = ''
      clearBlock(state)
      const account = accounts.value.find(a => a.id === id)
      if (account && (await loadTimes(account, state, Date.now()))) clearBlock(state)
      persistStates()
    }
  }

  // Runs once per page load. A failure leaves the plain token working and is retried on the next load.
  async function sealLegacyAccounts() {
    for (const account of accounts.value.filter(a => !a.token.startsWith(SEALED_PREFIX))) {
      try {
        const { token, employees } = await sealKey(account.token)
        if (tokenReplaced(account)) continue
        accounts.value = accounts.value.map(a => (a.id === account.id ? { ...a, token } : a))
        const state = states[account.id]
        if (state && state.employeesFetchedAt == null) {
          state.employees = sortByName(employees)
          state.employeesFetchedAt = Date.now()
        }
      } catch {
        continue
      }
    }
    persistStates()
  }

  function renameAccount(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    accounts.value = accounts.value.map(a => (a.id === id ? { ...a, name: trimmed } : a))
  }

  function setRefreshMinutes(id: string, refreshMinutes: RefreshMinutes) {
    accounts.value = accounts.value.map(a => (a.id === id ? { ...a, refreshMinutes } : a))
  }

  function deleteAccount(id: string) {
    const index = accounts.value.findIndex(a => a.id === id)
    accounts.value = accounts.value.filter(a => a.id !== id)
    delete states[id]
    persistStates()
    if (activeId.value === id) {
      activeId.value = accounts.value[Math.min(index, accounts.value.length - 1)]?.id ?? null
    }
  }

  function setActive(id: string) {
    activeId.value = id
  }

  function toggleHidden(employeeId: string) {
    const id = activeId.value
    accounts.value = accounts.value.map(a => {
      if (a.id !== id) return a
      const hidden = a.hiddenEmployeeIds.includes(employeeId)
        ? a.hiddenEmployeeIds.filter(h => h !== employeeId)
        : [...a.hiddenEmployeeIds, employeeId]
      return { ...a, hiddenEmployeeIds: hidden }
    })
  }

  async function clock(employee: Employee, action: ClockAction) {
    const account = activeAccount.value
    if (!account) return
    const state = states[account.id]
    if (!state) return
    state.clocking[employee.id] = true
    state.actionError = ''

    const setPaused = (on: boolean) => {
      const next = new Set(state.pausedIds)
      if (on) next.add(employee.id)
      else next.delete(employee.id)
      state.pausedIds = next
    }
    let failed = false
    try {
      await clockRequest(account.token, employee.id, action)
      const doneAt = Date.now()
      state.entries = applyClock(state.entries, employee.id, action, doneAt)
      state.lastActionAt = doneAt
      state.quotaUntil = null
      setPaused(action === 'pause')
    } catch (e) {
      failed = true
      if (e instanceof ApiError && e.status === 429) noteFailure(account, state, e, Date.now())
      state.actionError = `Error al fichar a ${employee.name}: ${describeError(e)}`
      if (action === 'unpause') setPaused(false)
    } finally {
      state.clocking[employee.id] = false
    }

    if (failed && !isBlocked(state, Date.now())) await loadTimes(account, state, Date.now())
    persistStates()
  }

  function dismissActionError() {
    const state = activeId.value ? states[activeId.value] : undefined
    if (state) state.actionError = ''
  }

  watch(accounts, value => saveAccounts(localStorage, value), { deep: true })
  watch(activeId, value => {
    saveActiveAccountId(localStorage, value)
    syncActive('view')
  })

  let tickTimer: number | undefined

  const inUse = (at: number) => isInUse(document.visibilityState === 'visible', lastTouchAt, at)

  const onVisibilityChange = () => {
    if (inUse(Date.now())) syncActive('view')
  }

  const onTouch = () => {
    const at = Date.now()
    const wasIdle = !isInUse(true, lastTouchAt, at)
    lastTouchAt = at
    if (wasIdle) syncActive('view')
  }

  const onTick = () => {
    const at = Date.now()
    now.value = at
    if (activeAccount.value && activeAccount.value.refreshMinutes > 0 && inUse(at)) syncActive('tick')
  }

  const touchOptions = { passive: true, capture: true }

  onMounted(() => {
    void sealLegacyAccounts().then(() => syncActive('view'))
    tickTimer = window.setInterval(onTick, TICK_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('pointerdown', onTouch, touchOptions)
    document.addEventListener('keydown', onTouch, touchOptions)
  })

  onBeforeUnmount(() => {
    window.clearInterval(tickTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    document.removeEventListener('pointerdown', onTouch, touchOptions)
    document.removeEventListener('keydown', onTouch, touchOptions)
  })

  return {
    accounts,
    activeId,
    activeAccount,
    activeState,
    statuses,
    now,
    quotaMessage: activeQuotaMessage,
    addAccount,
    changeToken,
    renameAccount,
    setRefreshMinutes,
    refreshInfo,
    deleteAccount,
    setActive,
    toggleHidden,
    clock,
    dismissActionError,
    refresh: () => syncActive('manual')
  }
}
