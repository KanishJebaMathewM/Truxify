import { describe, it, expect, vi, beforeEach } from 'vitest'
import hppProtection from '../../src/middleware/hppProtection.js'
import logger from '../../src/middleware/logger.js'

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

function makeReq(query = {}) {
  return {
    query,
    ip: '127.0.0.1',
    originalUrl: '/api/test',
    requestId: 'req-123'
  }
}

function makeRes() {
  return {
    on: vi.fn()
  }
}

describe('hppProtection middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call next() and not log warnings when req.query has no duplicate params', () => {
    const req = makeReq({ page: '1', limit: '10' })
    const res = makeRes()
    const next = vi.fn()

    hppProtection(req, res, next)

    expect(req.query).toEqual({ page: '1', limit: '10' })
    expect(next).toHaveBeenCalledOnce()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should normalize one duplicate param (array value) to first value and log a warning', () => {
    const req = makeReq({ status: ['active', 'pending'], page: '1' })
    const res = makeRes()
    const next = vi.fn()

    hppProtection(req, res, next)

    expect(req.query.status).toBe('active')
    expect(Array.isArray(req.query.status)).toBe(false)
    expect(next).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-123',
        ip: '127.0.0.1',
        duplicateParams: ['status']
      }),
      'Potential HTTP Parameter Pollution detected'
    )
  })

  it('should normalize multiple duplicate params and include all param names in the warning', () => {
    const req = makeReq({ role: ['admin', 'user'], sort: ['asc', 'desc'] })
    const res = makeRes()
    const next = vi.fn()

    hppProtection(req, res, next)

    expect(req.query.role).toBe('admin')
    expect(req.query.sort).toBe('asc')
    expect(next).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-123',
        ip: '127.0.0.1',
        duplicateParams: expect.arrayContaining(['role', 'sort'])
      }),
      'Potential HTTP Parameter Pollution detected'
    )
  })

  it('should handle empty query object gracefully', () => {
    const req = makeReq({})
    const res = makeRes()
    const next = vi.fn()

    hppProtection(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
