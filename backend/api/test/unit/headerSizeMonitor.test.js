import { describe, it, expect, vi, beforeEach } from 'vitest'
import headerSizeMonitor from '../../src/middleware/headerSizeMonitor.js'
import logger from '../../src/middleware/logger.js'

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}))

describe('headerSizeMonitor middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should allow normal-sized headers to pass through without action', () => {
    const req = {
      method: 'GET',
      path: '/api/health',
      ip: '127.0.0.1',
      headers: {
        'host': 'localhost',
        'user-agent': 'test-agent'
      }
    }
    const res = {}
    const next = vi.fn()

    headerSizeMonitor(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should trigger a warning when headers exceed the size threshold and include request metadata', () => {
    const largeHeaderValue = 'a'.repeat(12000)
    const req = {
      method: 'POST',
      path: '/api/submit',
      originalUrl: '/api/submit',
      ip: '192.168.1.50',
      headers: {
        'x-custom-payload': largeHeaderValue
      }
    }
    const res = {}
    res.status = vi.fn(() => res)
    res.json = vi.fn(() => res)
    const next = vi.fn()

    headerSizeMonitor(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(431)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Request header fields too large',
    })
    expect(logger.warn).toHaveBeenCalled()
    
    const logCallArg = JSON.stringify(logger.warn.mock.calls[0])
    expect(logCallArg).toContain('POST')
    expect(logCallArg).toContain('/api/submit')
    expect(logCallArg).toContain('192.168.1.50')
  })

  it('should sum multiple headers for total size calculation', () => {
    const req = {
      method: 'GET',
      path: '/api/data',
      originalUrl: '/api/data',
      ip: '10.0.0.5',
      headers: {
        'h1': 'a'.repeat(4000),
        'h2': 'b'.repeat(4000),
        'h3': 'c'.repeat(3000)
      }
    }
    const res = {}
    res.status = vi.fn(() => res)
    res.json = vi.fn(() => res)
    const next = vi.fn()

    headerSizeMonitor(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(431)
    expect(logger.warn).toHaveBeenCalled()
  })
})
