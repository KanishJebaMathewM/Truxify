/**
 * Unit tests for backend/api/src/routes/trackingRoutes.js
 *
 * Coverage:
 *   - POST /:id/share-tracking runs the orders pre-check and token creation
 *     through createUserClient(req.token), never the shared anon client
 *   - POST /:id/share-tracking/revoke does the same
 *
 * Run with:  npm test -- test/unit/trackingRoutes.test.js
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
    throw new Error('shared anon client must not be used by /share-tracking')
  }) },
  createUserClient: createUserClientMock,
  redisClient: { get: vi.fn(), set: vi.fn() },
}))

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'customer-1', role: 'customer' }
    req.token = 'customer-jwt'
    next()
  },
}))

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}))

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
}))

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  createStore: () => ({ on: vi.fn() }),
  safeIpKeyGenerator: (req) => req.ip || 'unknown',
}))

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}))

const buildOrderChain = (data, error) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({ data, error })),
})

const buildInsertChain = (data, error) => ({
  insert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({ data, error })),
})

import trackingRoutes from '../../src/routes/trackingRoutes.js'

const app = express()
app.use(express.json())
app.use('/api/orders', trackingRoutes)

describe('POST /api/orders/:id/share-tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the order pre-check and token creation through createUserClient(req.token)', async () => {
    const tokenRow = { id: 'token-1', order_display_id: 'ORD-1', expires_at: '2030-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }
    const orderChain = buildOrderChain({ order_display_id: 'ORD-1', customer_id: 'customer-1', status: 'in_transit' }, null)
    const insertChain = buildInsertChain(tokenRow, null)

    userClientFrom.mockImplementation((table) => {
      if (table === 'orders') return orderChain
      if (table === 'tracking_tokens') return insertChain
      throw new Error(`unexpected table: ${table}`)
    })
    createUserClientMock.mockReturnValue({ from: userClientFrom })

    const res = await request(app).post('/api/orders/ORD-1/share-tracking').send({})

    expect(res.status).toBe(201)
    expect(createUserClientMock).toHaveBeenCalledWith('customer-jwt')
    expect(userClientFrom).toHaveBeenCalledWith('orders')
    expect(userClientFrom).toHaveBeenCalledWith('tracking_tokens')
    expect(res.body.token).toBeTruthy()
  })

  it('returns 403 for an order owned by another customer', async () => {
    userClientFrom.mockReturnValue(buildOrderChain({ order_display_id: 'ORD-1', customer_id: 'other-customer', status: 'in_transit' }, null))
    createUserClientMock.mockReturnValue({ from: userClientFrom })

    const res = await request(app).post('/api/orders/ORD-1/share-tracking').send({})

    expect(res.status).toBe(403)
  })

  it('returns 404 when the order is not found', async () => {
    userClientFrom.mockReturnValue(buildOrderChain(null, { message: 'not found' }))
    createUserClientMock.mockReturnValue({ from: userClientFrom })

    const res = await request(app).post('/api/orders/ORD-1/share-tracking').send({})

    expect(res.status).toBe(404)
  })
})

describe('POST /api/orders/:id/share-tracking/revoke', () => {
  it('runs the pre-check and revoke through createUserClient(req.token)', async () => {
    const orderChain = buildOrderChain({ order_display_id: 'ORD-1', customer_id: 'customer-1' }, null)
    const revokeChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve) => resolve({ error: null }),
    }

    userClientFrom.mockImplementation((table) => {
      if (table === 'orders') return orderChain
      if (table === 'tracking_tokens') return revokeChain
      throw new Error(`unexpected table: ${table}`)
    })
    createUserClientMock.mockReturnValue({ from: userClientFrom })

    const res = await request(app).post('/api/orders/ORD-1/share-tracking/revoke')

    expect(res.status).toBe(200)
    expect(createUserClientMock).toHaveBeenCalledWith('customer-jwt')
    expect(userClientFrom).toHaveBeenCalledWith('orders')
    expect(userClientFrom).toHaveBeenCalledWith('tracking_tokens')
  })
})
