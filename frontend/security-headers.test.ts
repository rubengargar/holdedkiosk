import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, headersFile } from './security-headers'

describe('contentSecurityPolicy', () => {
  it('limits connections to the same origin when no worker base is set', () => {
    expect(contentSecurityPolicy(undefined)).toContain("connect-src 'self';")
    expect(contentSecurityPolicy('')).toContain("connect-src 'self';")
  })

  it('adds only the origin of the worker base', () => {
    expect(contentSecurityPolicy('https://w.example.workers.dev/')).toContain(
      "connect-src 'self' https://w.example.workers.dev;"
    )
  })

  it('has no inline or eval script sources and forbids framing', () => {
    const csp = contentSecurityPolicy(undefined)
    expect(csp).toContain("script-src 'self';")
    expect(csp).not.toContain('unsafe')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('img-src \'self\' data: https://app.holded.com')
  })
})

describe('headersFile', () => {
  it('applies the security headers to every path', () => {
    const file = headersFile(undefined)
    expect(file.startsWith('/*\n')).toBe(true)
    for (const name of ['X-Frame-Options: DENY', 'Referrer-Policy: no-referrer', 'X-Content-Type-Options: nosniff', 'Permissions-Policy: camera=(), microphone=(), geolocation=()']) {
      expect(file).toContain(`  ${name}\n`)
    }
  })
})
