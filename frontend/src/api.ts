const API_BASE = import.meta.env.VITE_WORKER_BASE?.trim().replace(/\/+$/, '') ?? ''

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
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers: { 'X-Holded-API-Key': token } })
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

  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError(
      res.status,
      'El kiosko no puede contactar con su Worker. Si el frontend está alojado aparte, puede faltar VITE_WORKER_BASE.'
    )
  }
}

export interface Sealed {
  token: string
  employees: Employee[]
}

export const SEALED_PREFIX = 'sealed.'

export function sealKey(key: string): Promise<Sealed> {
  return request<Sealed>(key, '/api/seal', 'POST')
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
  if (e instanceof ApiError && e.status === 401 && e.message === 'Sealed token is not valid for this kiosk') {
    return 'Este kiosko ya no reconoce el token guardado de la empresa. Vuelve a introducir la clave de Holded en Ajustes, con "Cambiar token".'
  }
  if (e instanceof ApiError && e.status === 429) {
    return e.message.startsWith('Holded request failed')
      ? 'Holded está limitando las peticiones. Se mantienen los datos actuales y se reintentará más tarde.'
      : 'El kiosko está recibiendo demasiadas peticiones. Se mantienen los datos actuales y se reintentará más tarde.'
  }
  if (e instanceof ApiError && e.status === 503 && e.message !== 'Sealing is not available on this Worker') {
    return 'El servidor no está disponible temporalmente, inténtalo de nuevo en un minuto. Se mantienen los datos actuales.'
  }
  return e instanceof Error ? e.message : String(e)
}
