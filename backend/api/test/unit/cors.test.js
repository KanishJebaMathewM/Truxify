import { describe, it, expect } from 'vitest'

process.env.NODE_ENV = 'development'
process.env.ALLOWED_ORIGINS = 'https://app.example.com, http://localhost:3000, not-a-url'

const { corsMiddleware } = await import('../../src/middleware/cors.js')

function makeRes() {
  const headers = {}
  return {
    headers,
    getHeader(name) { return headers[name.toLowerCase()] },
    setHeader(name, value) { headers[name.toLowerCase()] = String(value) },
    removeHeader(name) { delete headers[name.toLowerCase()] },
    writeHead() { return this },
    end() {}, write() {},
  }
}

function invoke(origin) {
  return new Promise((resolve) => {
    const req = { headers: {} }
    if (origin) req.headers.origin = origin
    const res = makeRes()
    let nextCalled = false
    corsMiddleware(req, res, () => { nextCalled = true; resolve({ res, nextCalled, req }) })
  })
}

describe('corsMiddleware', () => {
  it('allows an origin present in ALLOWED_ORIGINS', async () => {
    const { res } = await invoke('https://app.example.com')
    expect(res.getHeader('access-control-allow-origin')).toBe('https://app.example.com')
  })

  it('allows localhost in non-production environments', async () => {
    const { res } = await invoke('http://localhost:8080')
    expect(res.getHeader('access-control-allow-origin')).toBe('http://localhost:8080')
  })

  it('rejects an unknown origin not in the allow list', async () => {
    const { res } = await invoke('https://evil.example.com')
    expect(res.getHeader('access-control-allow-origin')).toBeUndefined()
  })

  it('calls next for requests without an Origin header', async () => {
    const { nextCalled } = await invoke(null)
    expect(nextCalled).toBe(true)
  })

  it('restricts localhost origins in production', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      // Re-import with a fresh module registry so the production branch of
      // the module-level config is evaluated.
      const { vi } = await import('vitest')
      vi.resetModules()
      const { corsMiddleware: prodCors } = await import('../../src/middleware/cors.js')
      const { res } = await new Promise((resolve) => {
        const req = { headers: { origin: 'http://localhost:8080' } }
        const r = makeRes()
        prodCors(req, r, () => resolve({ res: r }))
      })
      expect(res.getHeader('access-control-allow-origin')).toBeUndefined()
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })

  it('allows localhost when the origin has surrounding whitespace', async () => {
    const { res } = await invoke('  http://localhost:8080  ')
    expect(res.getHeader('access-control-allow-origin')).toBeTruthy()
  })

  it('allows localhost with a case-variant hostname', async () => {
    const { res } = await invoke('http://LOCALHOST:8080')
    expect(res.getHeader('access-control-allow-origin')).toBe('http://LOCALHOST:8080')
  })
})
