import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadApi(base: string | undefined) {
  vi.resetModules()
  if (base === undefined) Reflect.deleteProperty(import.meta.env, 'VITE_WORKER_BASE')
  else vi.stubEnv('VITE_WORKER_BASE', base)
  return import('./api')
}

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function stubResponse(res: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => res))
}

describe('non-JSON success', () => {
  it('maps an HTML 200 to an ApiError that names VITE_WORKER_BASE', async () => {
    stubResponse(new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    const { getEmployees, ApiError } = await loadApi(undefined)

    const error = await getEmployees('k').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as Error).message).toContain('VITE_WORKER_BASE')
    expect((error as Error).message).not.toMatch(/JSON|token/i)
  })
})

describe('describeError on 429', () => {
  it.each([
    ['Too many requests', 'El kiosko está recibiendo demasiadas peticiones'],
    ['Holded request failed', 'Holded está limitando las peticiones'],
    ['Holded request failed: slow down', 'Holded está limitando las peticiones'],
  ])('describes %j', async (body, expected) => {
    stubResponse(new Response(JSON.stringify({ error: body.split(':')[0], detail: body.split(': ')[1] }), { status: 429 }))
    const { getEmployees, describeError } = await loadApi(undefined)

    const error = await getEmployees('k').catch((e: unknown) => e)

    expect(describeError(error)).toContain(expected)
  })
})

describe('api base', () => {
  it.each([undefined, '', '  '])('calls the same origin when the base is %j', async (base) => {
    const fetchMock = stubFetch()
    const { getEmployees } = await loadApi(base)

    await getEmployees('key-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/employees', expect.objectContaining({ method: 'GET' }))
  })

  it('calls the configured base, without a trailing slash', async () => {
    const fetchMock = stubFetch()
    const { getTimes } = await loadApi('https://worker.test/')

    await getTimes('key-1', 5)

    expect(fetchMock).toHaveBeenCalledWith('https://worker.test/api/times?since=5', expect.anything())
  })

  it('sends the token header and posts clock actions to the same origin', async () => {
    const fetchMock = stubFetch()
    const { clock } = await loadApi(undefined)

    await clock('key-1', 'abc', 'clock-in')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/employees/abc/clock-in',
      expect.objectContaining({ method: 'POST', headers: { 'X-Holded-API-Key': 'key-1' } })
    )
  })
})

describe('describeError on a sealed token this Worker cannot open', () => {
  it('tells the user to enter the key again', async () => {
    const { describeError, ApiError } = await loadApi(undefined)

    expect(describeError(new ApiError(401, 'Sealed token is not valid for this kiosk'))).toContain('Vuelve a introducir')
    expect(describeError(new ApiError(401, 'Holded request failed: Unauthorized'))).toBe('Holded request failed: Unauthorized')
  })
})

describe('describeError on a 503', () => {
  it('asks to retry in a minute, keeps the data and does not ask to re-enter the key', async () => {
    const { describeError, ApiError } = await loadApi(undefined)

    const message = describeError(new ApiError(503, 'Sealing key is not available yet, try again in a minute'))

    expect(message).toContain('inténtalo de nuevo en un minuto')
    expect(message).toContain('Se mantienen los datos actuales')
    expect(message).not.toContain('Vuelve a introducir')
  })

  it('keeps the plain message when this Worker has no sealing at all', async () => {
    const { describeError, ApiError } = await loadApi(undefined)

    expect(describeError(new ApiError(503, 'Sealing is not available on this Worker'))).toBe('Sealing is not available on this Worker')
  })
})

describe('a 401 from the Worker without a body', () => {
  it('names the kiosk password and asks for a reload, unlike the Holded and sealed-token 401s', async () => {
    stubResponse(new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Holded Kiosk"' } }))
    const { getEmployees, describeError, ApiError } = await loadApi(undefined)

    const error = await getEmployees('k').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    const message = describeError(error)
    expect(message).toContain('contraseña del kiosko')
    expect(message).toContain('Recarga')
    expect(message).not.toContain('Holded request failed')
    expect(message).not.toContain('Vuelve a introducir')
  })
})

describe('429 rate-limit headers', () => {
  it('reads the window, reset and Retry-After into the ApiError', async () => {
    stubResponse(
      new Response('{"error":"Holded request failed"}', {
        status: 429,
        headers: { 'X-RateLimit-Window': 'month', 'X-RateLimit-Reset': '1790000000', 'Retry-After': '90' }
      })
    )
    const { getEmployees, ApiError } = await loadApi('https://worker.test')

    const error = await getEmployees('t').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as InstanceType<typeof ApiError>).rateLimit).toEqual({
      window: 'month',
      resetAtMs: 1790000000 * 1000,
      retryAfterMs: 90_000
    })
  })

  it('leaves unknown or missing values null', async () => {
    const { parseRateLimit } = await loadApi('https://worker.test')

    expect(parseRateLimit(new Headers({ 'X-RateLimit-Window': 'week', 'Retry-After': 'soon' }))).toEqual({
      window: null,
      resetAtMs: null,
      retryAfterMs: null
    })
  })
})
