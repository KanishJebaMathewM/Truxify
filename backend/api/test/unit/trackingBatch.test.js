import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { supabaseAdminFrom } = vi.hoisted(() => ({
  supabaseAdminFrom: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: { from: supabaseAdminFrom },
  createUserClient: vi.fn(),
  redisClient: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'driver-offline-1', role: 'driver' };
    req.token = 'mock-driver-token';
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  createStore: () => ({ on: vi.fn() }),
  safeIpKeyGenerator: (req) => req.ip || 'unknown',
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

import trackingRoutes from '../../src/routes/trackingRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/tracking', trackingRoutes);

describe('POST /api/tracking/batch (offline replay)', () => {
  let historyUpsertMock;
  let tripEventsUpsertMock;
  let driverLocationsSelectMock;
  let driverLocationsUpsertMock;

  beforeEach(() => {
    vi.clearAllMocks();

    historyUpsertMock = vi.fn().mockResolvedValue({ error: null });
    tripEventsUpsertMock = vi.fn().mockResolvedValue({ error: null });
    driverLocationsUpsertMock = vi.fn().mockResolvedValue({ error: null });
    driverLocationsSelectMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { recorded_at: '2026-10-28T10:00:00.000Z' },
          error: null,
        }),
      })),
    }));

    supabaseAdminFrom.mockImplementation((table) => {
      if (table === 'driver_location_history') {
        return { upsert: historyUpsertMock };
      }
      if (table === 'trip_events') {
        return { upsert: tripEventsUpsertMock };
      }
      if (table === 'driver_locations') {
        return {
          select: driverLocationsSelectMock,
          upsert: driverLocationsUpsertMock,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('replays chronological GPS trail and updates newest driver location', async () => {
    const payload = {
      trip_id: 'TRIP-999',
      batch_id: 'batch-uuid-1',
      coordinates: [
        {
          latitude: 19.0760,
          longitude: 72.8777,
          speed: 40.0,
          heading: 90.0,
          accuracy: 5.0,
          timestamp: '2026-10-28T10:05:00.000Z',
        },
        {
          latitude: 19.0800,
          longitude: 72.8800,
          speed: 45.0,
          heading: 92.0,
          accuracy: 4.0,
          timestamp: '2026-10-28T10:10:00.000Z',
        },
      ],
    };

    const res = await request(app).post('/api/tracking/batch').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.replayed_count).toBe(2);
    expect(res.body.batch_id).toBe('batch-uuid-1');
    expect(res.body.latest_coordinate.latitude).toBe(19.0800);

    // Verify history upsert received chronologically sorted trail
    expect(historyUpsertMock).toHaveBeenCalledTimes(1);
    const historyCalls = historyUpsertMock.mock.calls[0][0];
    expect(historyCalls).toHaveLength(2);
    expect(historyCalls[0].latitude).toBe(19.0760);
    expect(historyCalls[1].latitude).toBe(19.0800);

    // Verify trip events telemetry recorded
    expect(tripEventsUpsertMock).toHaveBeenCalledTimes(1);
    const tripCalls = tripEventsUpsertMock.mock.calls[0][0];
    expect(tripCalls).toHaveLength(2);
    expect(tripCalls[0].trip_id).toBe('TRIP-999');
    expect(tripCalls[0].event_type).toBe('gpsUpdate');

    // Verify current driver_locations updated with newest position
    expect(driverLocationsUpsertMock).toHaveBeenCalledTimes(1);
    const currentCall = driverLocationsUpsertMock.mock.calls[0][0];
    expect(currentCall.driver_id).toBe('driver-offline-1');
    expect(currentCall.latitude).toBe(19.0800);
  });

  it('filters out invalid coordinates and persists remaining valid coordinates', async () => {
    const payload = {
      coordinates: [
        null,
        { latitude: 999, longitude: 72.8777 }, // Invalid lat > 90
        { latitude: 19.0760, longitude: 72.8777, timestamp: '2026-10-28T10:15:00.000Z' }, // Valid
        { latitude: 19.0780, longitude: 200 }, // Invalid lng > 180
      ],
    };

    const res = await request(app).post('/api/tracking/batch').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.replayed_count).toBe(1);
    expect(historyUpsertMock.mock.calls[0][0]).toHaveLength(1);
    expect(historyUpsertMock.mock.calls[0][0][0].latitude).toBe(19.0760);
  });

  it('rejects an empty batch with 400 Bad Request', async () => {
    const res = await request(app).post('/api/tracking/batch').send({ coordinates: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/coordinates must be a non-empty array/i);
    expect(historyUpsertMock).not.toHaveBeenCalled();
  });
});
