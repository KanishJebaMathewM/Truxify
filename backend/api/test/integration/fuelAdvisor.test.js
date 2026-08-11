import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: truckRouter } = await import('../../src/routes/truckRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/trucks', truckRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
};

describe('Fuel Advisor Routes', () => {
  beforeEach(() => {
    m.calls.length = 0;
    m.store.trucks = [
      { id: 'truck-1', driver_id: 'driver-1' },
      { id: 'truck-2', driver_id: 'driver-2' },
    ];
    m.store.orders = [];
    m.store.trip_events = [];
  });

  it('GET /api/v1/trucks/:id/fuel-advisor returns 400 if destination coordinates are missing', async () => {
    const res = await request(buildApp())
      .get('/api/v1/trucks/truck-1/fuel-advisor')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing or invalid destination_lat');
  });

  it('GET /api/v1/trucks/:id/fuel-advisor returns 403 if driver does not own the truck', async () => {
    const res = await request(buildApp())
      .get('/api/v1/trucks/truck-2/fuel-advisor?destination_lat=30&destination_lng=70')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(403);
  });

  it('GET /api/v1/trucks/:id/fuel-advisor recommends B20 for warm weather', async () => {
    // Lat 30 is warm (>0C) in our mock
    const res = await request(buildApp())
      .get('/api/v1/trucks/truck-1/fuel-advisor?destination_lat=30&destination_lng=70')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.recommended_blend).toBe('B20');
    expect(res.body.factors.weather_forecast.temperature_c).toBe(15);
  });

  it('GET /api/v1/trucks/:id/fuel-advisor recommends B5 for sub-zero weather and low engine load', async () => {
    // Lat 45 is sub-zero (-5C) in our mock
    m.store.orders = [{ id: 'order-1', truck_id: 'truck-1', status: 'in_transit' }];
    m.store.trip_events = [
      { trip_id: 'order-1', event_type: 'gpsUpdate', payload: { engineLoad: 40 } },
      { trip_id: 'order-1', event_type: 'gpsUpdate', payload: { engineLoad: 50 } },
    ];

    const res = await request(buildApp())
      .get('/api/v1/trucks/truck-1/fuel-advisor?destination_lat=45&destination_lng=70')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.recommended_blend).toBe('B5');
    expect(res.body.factors.average_engine_load_percent).toBe(45);
    expect(res.body.factors.weather_forecast.temperature_c).toBe(-5);
  });

  it('GET /api/v1/trucks/:id/fuel-advisor recommends B20 for sub-zero weather and high engine load', async () => {
    // Lat 45 is sub-zero (-5C) in our mock
    m.store.orders = [{ id: 'order-1', truck_id: 'truck-1', status: 'in_transit' }];
    m.store.trip_events = [
      { trip_id: 'order-1', event_type: 'gpsUpdate', payload: { engineLoad: 70 } },
      { trip_id: 'order-1', event_type: 'gpsUpdate', payload: { engineLoad: 80 } },
    ];

    const res = await request(buildApp())
      .get('/api/v1/trucks/truck-1/fuel-advisor?destination_lat=45&destination_lng=70')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.recommended_blend).toBe('B20');
    expect(res.body.factors.average_engine_load_percent).toBe(75);
    expect(res.body.risk_level).toBe('MEDIUM');
  });
});
