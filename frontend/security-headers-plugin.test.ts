import { describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'vite'
import config from './vite.config'

function emittedHeaders(workerBase: string | undefined): string {
  vi.unstubAllEnvs()
  if (workerBase !== undefined) vi.stubEnv('VITE_WORKER_BASE', workerBase)
  const resolved = typeof config === 'function' ? config({ mode: 'test', command: 'build' }) : config
  const plugin = (resolved as { plugins: Plugin[] }).plugins.find(
    (p) => (p as Plugin).name === 'security-headers'
  ) as Plugin
  const emitFile = vi.fn()
  const generateBundle = plugin.generateBundle as (this: { emitFile: typeof emitFile }) => void
  generateBundle.call({ emitFile })
  expect(emitFile).toHaveBeenCalledWith(expect.objectContaining({ fileName: '_headers' }))
  return emitFile.mock.calls[0][0].source as string
}

describe('security-headers plugin', () => {
  it('puts the worker origin, without trailing slash, in connect-src', () => {
    expect(emittedHeaders('https://w.example/')).toContain("connect-src 'self' https://w.example;")
  })

  it('limits connect-src to self without a worker base', () => {
    expect(emittedHeaders(undefined)).toContain("connect-src 'self';")
  })
})
