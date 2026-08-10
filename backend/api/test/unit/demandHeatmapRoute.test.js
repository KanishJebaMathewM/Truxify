/**
 * Unit tests for backend/api/src/routes/demandRoutes.js — GET /api/demand-heatmap
 *
 * Coverage:
 *   - load_offers are read through the caller's user-scoped client
 *     (createUserClient(req.token)), never the shared anon client
 *
 * Run with:  npm test -- test/unit/demandHeatmapRoute.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const { loadOffersFrom, createUserClientMock } = vi.hoisted(() => ({
  loadOffersFrom: vi.fn(),
  createUserClientMock: vi.fn(),
}))

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn(() => {
    throw new Error('shared anon client must not be used by /api/demand-heatmap')
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

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(async () => ({ predicted_demand: 0.5 })),
}))

const buildChain = (data, error) => ({
  select: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  then: (resolve) => resolve({ data, error }),
})

import demandRoutes from '../../src/routes/demandRoutes.js'

const app = express()
app.use('/api/demand-heatmap', demandRoutes)

describe('GET /api/demand-heatmap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads load_offers through createUserClient(req.token), not the anon client', async () => {
    loadOffersFrom.mockReturnValue(buildChain([], null))
    createUserClientMock.mockReturnValue({ from: loadOffersFrom })

    const res = await request(app).get('/api/demand-heatmap')

    expect(res.status).toBe(200)
    expect(createUserClientMock).toHaveBeenCalledWith('driver-jwt')
    expect(loadOffersFrom).toHaveBeenCalledWith('load_offers')
    expect(res.body.features).toEqual([])
  })

  it('returns 500 when the load_offers query fails', async () => {
    loadOffersFrom.mockReturnValue(buildChain(null, { message: 'permission denied' }))
    createUserClientMock.mockReturnValue({ from: loadOffersFrom })

    const res = await request(app).get('/api/demand-heatmap')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to fetch heatmap data.')
  })
})
