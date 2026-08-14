import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: {
    collection: (name) => ({
      find: () => ({
        toArray: () => Promise.resolve([]),
      }),
    }),
  },
}));

vi.mock('../../src/services/reputation.js', () => ({ getDriverReputation: () => ({ score: 100 }) }));
vi.mock('../../src/services/wallet/payoutProvider.js', () => ({ isPayoutProviderConfigured: () => false }));

const { default: driverRouter } = await import('../../src/routes/driverRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/driver', driverRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
};

describe('Driver WIM Sync Routes', () => {
  beforeEach(() => {
    m.calls.length = 0;
    m.store.trucks = [
      { id: 'truck-1', driver_id: 'driver-1' }
    ];
  });

  it('POST /api/driver/weigh-stations/sync-weight returns 400 for invalid payload', async () => {
    const res = await request(buildApp())
      .post('/api/driver/weigh-stations/sync-weight')
      .set(DRIVER_HEADERS)
      .send({ truck_id: 'truck-1' }); // missing axles

    expect(res.status).toBe(400);
  });

  it('POST /api/driver/weigh-stations/sync-weight returns 403 if truck is not owned by driver', async () => {
    m.store.trucks = [{ id: 'truck-1', driver_id: 'driver-2' }];

    const res = await request(buildApp())
      .post('/api/driver/weigh-stations/sync-weight')
      .set(DRIVER_HEADERS)
      .send({
        truck_id: 'truck-1',
        axles: [{ position: 'steer', pressure_psi: 40 }]
      });

    expect(res.status).toBe(403);
  });

  it('POST /api/driver/weigh-stations/sync-weight returns 200 BYPASS for legal weights', async () => {
    const res = await request(buildApp())
      .post('/api/driver/weigh-stations/sync-weight')
      .set(DRIVER_HEADERS)
      .send({
        truck_id: 'truck-1',
        axles: [
          { position: 'steer', pressure_psi: 30 },
          { position: 'drive', pressure_psi: 50 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('BYPASS');
    expect(res.body.gross_weight_lbs).toBe(30000);
  });

  it('GET /api/driver/weigh-stations/bypass-status returns 503 UNSUPPORTED (no real WIM provider)', async () => {
    const res = await request(buildApp())
      .get('/api/driver/weigh-stations/bypass-status?lat=19.076&lng=72.8777')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(503);
    expect(res.body.action).toBe('UNSUPPORTED');
    expect(res.body.supported).toBe(false);
    expect(res.body.simulated).toBe(true);
    expect(res.body.stationId).toBeNull();
  });

  it('GET /api/driver/weigh-stations/bypass-status returns 400 for invalid coordinates', async () => {
    const res = await request(buildApp())
      .get('/api/driver/weigh-stations/bypass-status?lat=abc&lng=72.8777')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(400);
  });
});
