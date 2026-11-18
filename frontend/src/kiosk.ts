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
import {
  clock as clockRequest,
  describeError,
  getAccountInfo,
  getEmployees,
  getTimes,
  type AccountInfo,
  type ClockAction,
  type Employee,
  type TimeEntry
} from './api'

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
}

type SyncMode = 'poll' | 'view' | 'manual'

const POLL_MS = 2 * 60_000
const EMPLOYEES_TTL_MS = 15 * 60_000
const TIMES_STALE_MS = 30_000
const TICK_MS = 60_000
const AUTO_NAME = /^Empresa \d+$/

function emptyState(): AccountState {
  return {
    employees: [],
    entries: [],
    employeesFetchedAt: null,
    timesFetchedAt: null,
    loading: false,
    error: '',
    actionError: '',
    pausedIds: new Set(),
    clocking: {},
    lastActionAt: null
  }
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
  for (const account of accounts.value) states[account.id] = emptyState()
  const now = ref(Date.now())
  const infoRequested = new Set<string>()

  const activeAccount = computed(() => accounts.value.find(a => a.id === activeId.value) ?? null)
  const activeState = computed<AccountState | null>(() => (activeId.value ? states[activeId.value] ?? null : null))
  const statuses = computed(() =>
    mergePaused(
      buildStatuses(activeState.value?.entries ?? [], dayStart(now.value)),
      activeState.value?.pausedIds ?? new Set()
    )
  )

  async function loadTimes(account: Account, state: AccountState, at: number) {
    try {
      const entries = await getTimes(account.token, dayStart(at))
      if (isStaleTimes(at, state.lastActionAt)) return
      state.entries = entries
      state.pausedIds = prunePaused(state.pausedIds, entries)
      state.timesFetchedAt = Date.now()
    } catch (e) {
      state.error = describeError(e)
    }
  }

  async function sync(id: string, mode: SyncMode) {
    const account = accounts.value.find(a => a.id === id)
    if (!account) return
    const state = states[id]
    if (!state || state.loading) return

    const at = Date.now()
    const needEmployees =
      mode === 'manual' ||
      state.employeesFetchedAt == null ||
      (mode === 'poll' && at - state.employeesFetchedAt > EMPLOYEES_TTL_MS)
    const needTimes =
      mode === 'manual' || state.timesFetchedAt == null || at - state.timesFetchedAt > TIMES_STALE_MS
    if (!needEmployees && !needTimes) return

    if (mode !== 'poll' && account.logo === undefined) void refreshInfo(id)

    state.loading = true
    state.error = ''

    const loadEmployees = async () => {
      try {
        state.employees = sortByName(await getEmployees(account.token))
        state.employeesFetchedAt = Date.now()
      } catch (e) {
        state.error = describeError(e)
      }
    }

    await Promise.all([needEmployees && loadEmployees(), needTimes && loadTimes(account, state, at)])
    state.loading = false
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

  async function addAccount(name: string, token: string) {
    const employees = await getEmployees(token)
    const info = await fetchAccountInfo(token)
    const holdedName = info?.name.trim()
    const account: Account = {
      id: newAccountId(),
      name: name.trim() || holdedName || `Empresa ${accounts.value.length + 1}`,
      token,
      hiddenEmployeeIds: [],
      logo: info ? info.logoUrl : null
    }
    states[account.id] = {
      ...emptyState(),
      employees: sortByName(employees),
      employeesFetchedAt: Date.now()
    }
    accounts.value = [...accounts.value, account]
    activeId.value = account.id
  }

  async function changeToken(id: string, token: string) {
    const trimmed = token.trim()
    const employees = await getEmployees(trimmed)
    const info = await fetchAccountInfo(trimmed)
    accounts.value = accounts.value.map(a => (a.id === id ? { ...a, token: trimmed } : a))
    applyInfo(id, info)
    const state = states[id]
    if (state) {
      state.employees = sortByName(employees)
      state.employeesFetchedAt = Date.now()
      state.error = ''
    }
  }

  function renameAccount(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    accounts.value = accounts.value.map(a => (a.id === id ? { ...a, name: trimmed } : a))
  }

  function deleteAccount(id: string) {
    const index = accounts.value.findIndex(a => a.id === id)
    accounts.value = accounts.value.filter(a => a.id !== id)
    delete states[id]
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
      setPaused(action === 'pause')
    } catch (e) {
      failed = true
      state.actionError = `Error al fichar a ${employee.name}: ${describeError(e)}`
      if (action === 'unpause') setPaused(false)
    } finally {
      state.clocking[employee.id] = false
    }

    if (failed) await loadTimes(account, state, Date.now())
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
  let pollTimer: number | undefined

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') syncActive('view')
  }

  onMounted(() => {
    syncActive('view')
    tickTimer = window.setInterval(() => {
      now.value = Date.now()
    }, TICK_MS)
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') syncActive('poll')
    }, POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onBeforeUnmount(() => {
    window.clearInterval(tickTimer)
    window.clearInterval(pollTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    accounts,
    activeId,
    activeAccount,
    activeState,
    statuses,
    now,
    addAccount,
    changeToken,
    renameAccount,
    refreshInfo,
    deleteAccount,
    setActive,
    toggleHidden,
    clock,
    dismissActionError,
    refresh: () => syncActive('manual')
  }
}
