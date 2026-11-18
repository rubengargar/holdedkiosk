const WORKER_BASE = import.meta.env.VITE_WORKER_BASE?.trim().replace(/\/+$/, '')

export interface Employee {
  id: string
  name: string
}

export interface TimeEntry {
  employeeId: string
  start: number
  end: number | null
  paused: boolean
}

export interface AccountInfo {
  name: string
  logoUrl: string | null
}

export type ClockAction = 'clock-in' | 'clock-out' | 'pause' | 'unpause'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface ErrorBody {
  error?: string
  detail?: string
}

async function request<T>(token: string, path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  if (!WORKER_BASE) throw new ApiError(0, 'VITE_WORKER_BASE no está configurado en frontend/.env')

  let res: Response
  try {
    res = await fetch(`${WORKER_BASE}${path}`, { method, headers: { 'X-Holded-API-Key': token } })
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor')
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody | null
    const message = body?.error
      ? body.detail
        ? `${body.error}: ${body.detail}`
        : body.error
      : `Error ${res.status}`
    throw new ApiError(res.status, message)
  }

  return (await res.json()) as T
}

export function getEmployees(token: string): Promise<Employee[]> {
  return request<Employee[]>(token, '/api/employees')
}

export function getAccountInfo(token: string): Promise<AccountInfo> {
  return request<AccountInfo>(token, '/api/account')
}

export function getTimes(token: string, since: number): Promise<TimeEntry[]> {
  return request<TimeEntry[]>(token, `/api/times?since=${since}`)
}

export function clock(token: string, employeeId: string, action: ClockAction): Promise<{ ok: true }> {
  return request(token, `/api/employees/${encodeURIComponent(employeeId)}/${action}`, 'POST')
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError && e.status === 429) {
    return 'Holded está limitando las peticiones. Se mantienen los datos actuales y se reintentará más tarde.'
  }
  return e instanceof Error ? e.message : String(e)
}
