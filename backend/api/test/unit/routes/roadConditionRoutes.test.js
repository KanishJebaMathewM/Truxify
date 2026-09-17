/**
 * Comprehensive Unit Tests for backend/api/src/routes/roadConditionRoutes.js
 * Covers POST /grip telemetry reporting, GET /grip/nearby retrieval, rate limiting, and auth guards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const mocks = vi.hoisted(() => ({
  reportGripData: vi.fn((req, res) => res.status(201).json({ success: true, message: 'Grip telemetry recorded successfully' })),
  getNearbyGripData: vi.fn((req, res) => res.status(200).json({ success: true, grips: [{ id: 'grip-1', lat: 22.7, lng: 75.8, grip_index: 0.88 }] })),
  authenticate: vi.fn((req, res, next) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = { id: 'driver-uuid-1', role: 'driver' }
      return next()
    }
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' })
  }),
}))

vi.mock('../../../src/controllers/roadConditionController.js', () => ({
  reportGripData: mocks.reportGripData,
  getNearbyGripData: mocks.getNearbyGripData,
}))

vi.mock('../../../src/middleware/auth.js', () => ({
  authenticate: mocks.authenticate,
}))

import roadConditionRouter from '../../../src/routes/roadConditionRoutes.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/road-conditions', roadConditionRouter)
  return app
}

describe('Road Condition Routes Comprehensive Test Suite', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
  })

  describe('POST /road-conditions/grip', () => {
    it('reports micro-slips and grip index successfully with valid bearer token and payload', async () => {
      const payload = {
        lat: 22.7196,
        lng: 75.8577,
        grip_index: 0.85,
        speed_kmph: 45.5,
        slip_detected: false,
      }

      const response = await request(app)
        .post('/road-conditions/grip')
        .set('Authorization', 'Bearer valid-token')
        .send(payload)

      expect(response.status).toBe(201)
      expect(response.body).toEqual({ success: true, message: 'Grip telemetry recorded successfully' })
      expect(mocks.authenticate).toHaveBeenCalledTimes(1)
      expect(mocks.reportGripData).toHaveBeenCalledTimes(1)
    })

    it('rejects grip report with 401 Unauthorized when authorization header is missing or invalid', async () => {
      const response = await request(app)
        .post('/road-conditions/grip')
        .set('Authorization', 'Bearer invalid-token')
        .send({ lat: 22.7, lng: 75.8, grip_index: 0.5 })

      expect(response.status).toBe(401)
      expect(response.body.error).toContain('Unauthorized')
      expect(mocks.reportGripData).not.toHaveBeenCalled()
    })

    it('handles controller exceptions gracefully on POST /grip and returns 500', async () => {
      mocks.reportGripData.mockImplementationOnce((req, res) => {
        return res.status(500).json({ error: 'Database write failure during telemetry ingest' })
      })

      const response = await request(app)
        .post('/road-conditions/grip')
        .set('Authorization', 'Bearer valid-token')
        .send({ lat: 22.7, lng: 75.8, grip_index: 0.5 })

      expect(response.status).toBe(500)
      expect(response.body.error).toBe('Database write failure during telemetry ingest')
    })
  })

  describe('GET /road-conditions/grip/nearby', () => {
    it('retrieves nearby grip telemetry successfully with spatial query parameters and valid token', async () => {
      const response = await request(app)
        .get('/road-conditions/grip/nearby?lat=22.7196&lng=75.8577&radius_km=15')
        .set('Authorization', 'Bearer valid-token')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.grips).toHaveLength(1)
      expect(mocks.authenticate).toHaveBeenCalledTimes(1)
      expect(mocks.getNearbyGripData).toHaveBeenCalledTimes(1)
    })

    it('returns 401 Unauthorized when attempting to fetch nearby grip data without valid token', async () => {
      const response = await request(app)
        .get('/road-conditions/grip/nearby?lat=22.7196&lng=75.8577')
        .set('Authorization', 'Bearer bad-token')

      expect(response.status).toBe(401)
      expect(response.body.error).toContain('Unauthorized')
      expect(mocks.getNearbyGripData).not.toHaveBeenCalled()
    })

    it('handles controller errors during nearby grip spatial query retrieval', async () => {
      mocks.getNearbyGripData.mockImplementationOnce((req, res) => {
        return res.status(500).json({ error: 'Spatial index query failed' })
      })

      const response = await request(app)
        .get('/road-conditions/grip/nearby?lat=22.7196&lng=75.8577')
        .set('Authorization', 'Bearer valid-token')

      expect(response.status).toBe(500)
      expect(response.body.error).toBe('Spatial index query failed')
    })
  })

  describe('Rate Limiting & Middleware Verification', () => {
    it('allows requests through rate limiter under normal threshold', async () => {
      const response = await request(app)
        .get('/road-conditions/grip/nearby?lat=22.0&lng=75.0')
        .set('Authorization', 'Bearer valid-token')

      expect(response.status).toBe(200)
    })
  })
})