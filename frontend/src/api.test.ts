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
