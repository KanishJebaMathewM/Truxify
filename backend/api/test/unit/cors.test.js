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
})
