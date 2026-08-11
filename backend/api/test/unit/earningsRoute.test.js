/**
 * Unit tests for backend/api/routes/earnings.js — GET /api/earnings/summary
 *
 * Coverage:
 *   - trips are queried through the caller's user-scoped client
 *     (createUserClient(req.token)), never the shared anon client
 *
 * Run with:  npm test -- test/unit/earningsRoute.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const { userClientFrom, createUserClientMock } = vi.hoisted(() => ({
  userClientFrom: vi.fn(),
  createUserClientMock: vi.fn(),
}))

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn(() => {
    throw new Error('shared anon client must not be used by /api/earnings/summary')
  }) },
  createUserClient: createUserClientMock,
}))

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'driver-123', role: 'driver' }
    req.token = 'driver-jwt'
    next()
  },
}))

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}))

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}))

vi.mock('../../src/middleware/validate.js', () => ({
  validateQuery: () => (_req, _res, next) => next(),
}))

const buildChain = (data, error) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  then: (resolve) => resolve({ data, error }),
})

import earningsRouter from '../../routes/earnings.js'

const app = express()
app.use('/api/earnings', earningsRouter)

describe('GET /api/earnings/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries trips through createUserClient(req.token), not the anon client', async () => {
    userClientFrom.mockReturnValue(buildChain([], null))
    createUserClientMock.mockReturnValue({ from: userClientFrom })

    const res = await request(app).get('/api/earnings/summary?period=monthly')

    expect(res.status).toBe(200)
    expect(createUserClientMock).toHaveBeenCalledWith('driver-jwt')
    expect(userClientFrom).toHaveBeenCalledWith('trips')
  })

  it('returns 500 when the trips query fails', async () => {
    userClientFrom.mockReturnValue(buildChain(null, { message: 'permission denied' }))
    createUserClientMock.mockReturnValue({ from: userClientFrom })

    const res = await request(app).get('/api/earnings/summary?period=monthly')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to fetch earnings summary.')
  })
})
