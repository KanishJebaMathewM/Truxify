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
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
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

  it('aggregates nearby loads into demand zones with normalized intensity', async () => {
    loadOffersFrom.mockReturnValue(buildChain([
      {
        pickup_lat: 13.0827,
        pickup_lng: 80.2707,
        pickup_address: 'Chennai A',
        status: 'available',
      },
      {
        pickup_lat: 13.0830,
        pickup_lng: 80.2710,
        pickup_address: 'Chennai B',
        status: 'available',
      },
      {
        pickup_lat: 28.6139,
        pickup_lng: 77.2090,
        pickup_address: 'Delhi',
        status: 'claimed',
      },
    ], null))
    createUserClientMock.mockReturnValue({ from: loadOffersFrom })

    const res = await request(app).get('/api/demand-heatmap')

    expect(res.status).toBe(200)
    expect(res.body.features).toHaveLength(2)

    const chennaiZone = res.body.features.find(
      (feature) => feature.properties.demand_count === 2
    )
    expect(chennaiZone).toBeDefined()
    expect(chennaiZone.properties.intensity).toBe(1)

    const delhiZone = res.body.features.find(
      (feature) => feature.properties.demand_count === 1
    )
    expect(delhiZone).toBeDefined()
    expect(delhiZone.properties.intensity).toBe(0.5)
  })
  it('ignores loads with missing pickup coordinates', async () => {
    loadOffersFrom.mockReturnValue(buildChain([
      {
        pickup_lat: null,
        pickup_lng: 80.2707,
        pickup_address: 'Missing latitude',
        status: 'available',
      },
      {
        pickup_lat: '   ',
        pickup_lng: '80.2710',
        pickup_address: 'Blank latitude',
        status: 'available',
      },
      {
        pickup_lat: 13.0827,
        pickup_lng: '',
        pickup_address: 'Missing longitude',
        status: 'available',
      },
      {
        pickup_lat: 13.0827,
        pickup_lng: 80.2707,
        pickup_address: 'Valid load',
        status: 'available',
      },
    ], null))
    createUserClientMock.mockReturnValue({ from: loadOffersFrom })

    const res = await request(app).get('/api/demand-heatmap')

    expect(res.status).toBe(200)
    expect(res.body.features).toHaveLength(1)
    expect(res.body.features[0].geometry.coordinates).toEqual([80.2707, 13.0827])
  })
  it('returns 500 when the load_offers query fails', async () => {
    loadOffersFrom.mockReturnValue(buildChain(null, { message: 'permission denied' }))
    createUserClientMock.mockReturnValue({ from: loadOffersFrom })

    const res = await request(app).get('/api/demand-heatmap')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to fetch heatmap data.')
  })
})


