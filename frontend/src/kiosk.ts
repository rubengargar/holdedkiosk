import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  loadAccounts,
  loadActiveAccountId,
  newAccountId,
  saveAccounts,
  saveActiveAccountId,
  type Account
} from './accounts'
import { applyClock, buildStatuses, dayStart, type ClockAction } from './board'
import {
  clockIn,
  clockOut,
  describeError,
  getEmployees,
  getTimes,
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
  clocking: Record<string, boolean>
}

type SyncMode = 'poll' | 'view' | 'manual'

const POLL_MS = 2 * 60_000
const EMPLOYEES_TTL_MS = 15 * 60_000
const TIMES_STALE_MS = 30_000
const TICK_MS = 60_000

function emptyState(): AccountState {
  return {
    employees: [],
    entries: [],
    employeesFetchedAt: null,
    timesFetchedAt: null,
    loading: false,
    error: '',
    clocking: {}
  }
}

function sortByName(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => a.name.localeCompare(b.name))
}

export function useKiosk() {
  const accounts = ref<Account[]>(loadAccounts(localStorage))
  const activeId = ref<string | null>(loadActiveAccountId(localStorage, accounts.value))
  const states = reactive<Record<string, AccountState>>({})
  const now = ref(Date.now())

  const activeAccount = computed(() => accounts.value.find(a => a.id === activeId.value) ?? null)
  const activeState = computed(() => (activeId.value ? stateFor(activeId.value) : null))
  const statuses = computed(() => buildStatuses(activeState.value?.entries ?? [], dayStart(now.value)))

  function stateFor(id: string): AccountState {
    if (!states[id]) states[id] = emptyState()
    return states[id]
  }

  async function sync(id: string, mode: SyncMode) {
    const account = accounts.value.find(a => a.id === id)
    if (!account) return
    const state = stateFor(id)
    if (state.loading) return

    const at = Date.now()
    const needEmployees =
      mode === 'manual' ||
      state.employeesFetchedAt == null ||
      (mode === 'poll' && at - state.employeesFetchedAt > EMPLOYEES_TTL_MS)
    const needTimes =
      mode !== 'view' || state.timesFetchedAt == null || at - state.timesFetchedAt > TIMES_STALE_MS
    if (!needEmployees && !needTimes) return

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
    const loadTimes = async () => {
      try {
        state.entries = await getTimes(account.token, dayStart(at))
        state.timesFetchedAt = Date.now()
      } catch (e) {
        state.error = describeError(e)
      }
    }

    await Promise.all([needEmployees && loadEmployees(), needTimes && loadTimes()])
    state.loading = false
  }

  function syncActive(mode: SyncMode) {
    if (activeId.value) void sync(activeId.value, mode)
  }

  async function addAccount(name: string, token: string) {
    const employees = await getEmployees(token)
    const account: Account = { id: newAccountId(), name, token, hiddenEmployeeIds: [] }
    states[account.id] = {
      ...emptyState(),
      employees: sortByName(employees),
      employeesFetchedAt: Date.now()
    }
    accounts.value = [...accounts.value, account]
    activeId.value = account.id
  }

  function renameAccount(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    accounts.value = accounts.value.map(a => (a.id === id ? { ...a, name: trimmed } : a))
  }

  function deleteAccount(id: string) {
    accounts.value = accounts.value.filter(a => a.id !== id)
    delete states[id]
    if (activeId.value === id) activeId.value = accounts.value[0]?.id ?? null
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
    const state = stateFor(account.id)
    state.clocking[employee.id] = true
    state.error = ''

    try {
      await (action === 'clock-in' ? clockIn : clockOut)(account.token, employee.id)
      state.entries = applyClock(state.entries, employee.id, action, Date.now())
    } catch (e) {
      state.error = `Error al fichar a ${employee.name}: ${describeError(e)}`
    } finally {
      state.clocking[employee.id] = false
    }
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
    renameAccount,
    deleteAccount,
    setActive,
    toggleHidden,
    clock,
    refresh: () => syncActive('manual')
  }
}
