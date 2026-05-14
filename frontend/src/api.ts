const WORKER_BASE = import.meta.env.VITE_WORKER_BASE?.trim()

export interface EmployeeDashboard {
  id: string
  name: string
  isClockedIn: boolean
  isPaused: boolean
  trackedTimeToday: string
}

function getStoredToken(): string {
  const token = localStorage.getItem('holded_token')
  if (!token) throw new Error('No token stored')
  return token
}

function getWorkerBase(): string {
  if (!WORKER_BASE) {
    throw new Error('VITE_WORKER_BASE no está configurado en frontend/.env')
  }

  return WORKER_BASE
}

function getRequestHeaders(): HeadersInit {
  return {
    'X-Holded-API-Key': getStoredToken(),
    'X-Client-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone
  }
}

async function parseJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${fallbackMessage}: ${res.status} - ${text}`)
  }

  return res.json()
}

export async function getEmployeeDashboard(forceRefresh = false): Promise<EmployeeDashboard[]> {
  const search = forceRefresh ? '?forceRefresh=1' : ''
  const res = await fetch(`${getWorkerBase()}/api/dashboard${search}`, {
    headers: getRequestHeaders()
  })

  return parseJsonResponse<EmployeeDashboard[]>(res, 'Error fetching dashboard')
}

async function postEmployeeAction(employeeId: string, action: 'clockin' | 'clockout' | 'pause' | 'unpause') {
  const res = await fetch(`${getWorkerBase()}/api/employees/${employeeId}/${action}`, {
    method: 'POST',
    headers: getRequestHeaders()
  })

  return parseJsonResponse<EmployeeDashboard>(res, `Error performing ${action}`)
}

export function clockIn(employeeId: string) {
  return postEmployeeAction(employeeId, 'clockin')
}

export function clockOut(employeeId: string) {
  return postEmployeeAction(employeeId, 'clockout')
}

export function pauseEmployee(employeeId: string) {
  return postEmployeeAction(employeeId, 'pause')
}

export function unpauseEmployee(employeeId: string) {
  return postEmployeeAction(employeeId, 'unpause')
}
