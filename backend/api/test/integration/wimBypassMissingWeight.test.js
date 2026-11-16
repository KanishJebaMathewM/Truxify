import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  supabaseAdmin: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  createUserClient: () => m.supabase,
  mongoDb: {
    collection: () => ({
      find: () => ({ toArray: () => Promise.resolve([]) }),
    }),
  },
}));

// Mocked so this suite exercises the weight guard itself. The real auth
// middleware transitively imports src/lib/profileCache.js, which currently
// fails to parse on origin/main and takes the whole integration tier with it.
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'driver-1', role: 'driver' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const { default: wimBypassRouter } = await import('../../src/routes/wimBypass.js');
const { evaluateBypassEligibility } = await import('../../src/services/wimBypass.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wim', wimBypassRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
};

async function requestBypass() {
  return request(buildApp())
    .post('/api/wim/request-bypass')
    .set(DRIVER_HEADERS)
    .send({ truckId: 'truck-1', bolId: 'BOL-001' });
}

/**
 * Sets the registered weight/capacity for the fixture driver, truck and load.
 * `undefined` is normalised to null so it exercises the same SQL NULL path.
 */
function setWeights({ loadWeight, truckCapacity }) {
  m.store.orders[0].weight_tonnes = loadWeight === undefined ? null : loadWeight;
  m.store.trucks[0].max_capacity_tons = truckCapacity === undefined ? null : truckCapacity;
}

describe('WIM bypass — fail closed on missing or invalid registered weight', () => {
  beforeEach(() => {
    m.calls.length = 0;
    m.store.trucks = [{ id: 'truck-1', driver_id: 'driver-1', max_capacity_tons: 20 }];
    m.store.orders = [
      {
        id: 'order-1',
        order_display_id: 'BOL-001',
        driver_id: 'driver-1',
        truck_id: 'truck-1',
        weight_tonnes: 15,
      },
    ];
    m.store.profiles = [{ id: 'driver-1', is_digilocker_verified: true }];
  });

  it('grants a bypass for a fully valid load (guards against over-correcting)', async () => {
    const res = await requestBypass();

    expect(res.status).toBe(200);
    expect(res.body.signal).toBe('BYPASS');
    expect(res.body.wimPacket).toBeDefined();
  });

  it('does not grant a bypass when the load has NO registered weight', async () => {
    // Number(null) === 0, so the old code computed a zero-pound axle weight and
    // 0 > maxWeightLimit was false, granting a bypass for an unknown load.
    setWeights({ loadWeight: null });
    const res = await requestBypass();

    expect(res.status).toBe(200);
    expect(res.body.signal).toBe('PULL_IN');
    expect(res.body.wimPacket).toBeUndefined();
  });

  it('does not grant a bypass when the load weight is zero', async () => {
    setWeights({ loadWeight: 0 });
    const res = await requestBypass();

    expect(res.body.signal).toBe('PULL_IN');
    expect(res.body.wimPacket).toBeUndefined();
  });

  it('does not grant a bypass when the load weight is negative', async () => {
    setWeights({ loadWeight: -5 });
    const res = await requestBypass();

    expect(res.body.signal).toBe('PULL_IN');
    expect(res.body.wimPacket).toBeUndefined();
  });

  it('does not grant a bypass when the truck has no registered capacity', async () => {
    setWeights({ loadWeight: 15, truckCapacity: null });
    const res = await requestBypass();

    expect(res.body.signal).toBe('PULL_IN');
    expect(res.body.wimPacket).toBeUndefined();
  });

  it('does not grant a bypass when BOTH the load weight and truck capacity are missing', async () => {
    // 0 > 0 is false, so this degenerate case also used to slip through.
    setWeights({ loadWeight: null, truckCapacity: null });
    const res = await requestBypass();

    expect(res.body.signal).toBe('PULL_IN');
    expect(res.body.wimPacket).toBeUndefined();
  });

  it('does not sign a packet that claims a zero axle weight', async () => {
    setWeights({ loadWeight: null });
    const res = await requestBypass();

    expect(res.body.wimPacket).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('BYPASS');
  });
});

describe('evaluateBypassEligibility — rejects non-positive weights (defense in depth)', () => {
  it('rejects a zero axle weight even though typeof says number', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: 100, axleWeight: 0, maxWeightLimit: 40000 }),
    ).toBe(false);
  });

  it('rejects a negative axle weight', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: 100, axleWeight: -1000, maxWeightLimit: 40000 }),
    ).toBe(false);
  });

  it('rejects a zero weight limit', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: 100, axleWeight: 1000, maxWeightLimit: 0 }),
    ).toBe(false);
  });

  it('rejects a non-finite axle weight', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: 100, axleWeight: NaN, maxWeightLimit: 40000 }),
    ).toBe(false);
  });

  it('still accepts a genuine in-limit load', () => {
    expect(
      evaluateBypassEligibility({ safetyScore: 100, axleWeight: 30000, maxWeightLimit: 40000 }),
    ).toBe(true);
  });
});
