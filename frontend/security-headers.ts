const SECURITY_HEADERS = [
  'X-Frame-Options: DENY',
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy: no-referrer',
  'Permissions-Policy: camera=(), microphone=(), geolocation=()',
]

export function apiOrigin(workerBase: string | undefined): string | null {
  const base = workerBase?.trim()
  if (!base) return null
  return new URL(base).origin
}

export function contentSecurityPolicy(workerBase: string | undefined): string {
  const connect = ["'self'", apiOrigin(workerBase)].filter(Boolean).join(' ')
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https://app.holded.com",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function headersFile(workerBase: string | undefined): string {
  const lines = [...SECURITY_HEADERS, `Content-Security-Policy: ${contentSecurityPolicy(workerBase)}`]
  return `/*\n${lines.map((line) => `  ${line}`).join('\n')}\n`
}
