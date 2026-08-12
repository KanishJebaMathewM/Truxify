import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const {
  default: wimBypassRouter,
} = await import('../../src/routes/wimBypass.js');
const { createSignedWimPacket, WIM_PACKET_VERSION } = await import('../../src/services/wimBypass.js');

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

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-1',
  'x-user-role': 'customer',
};

async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

describe('WIM bypass — secure issuance (POST /api/wim/request-bypass)', () => {
  beforeEach(() => {
    m.calls.length = 0;
    m.store.trucks = [
      { id: 'truck-1', driver_id: 'driver-1', max_capacity_tons: 20 },
    ];
    m.store.orders = [
      {
        id: 'order-1',
        order_display_id: 'BOL-001',
        driver_id: 'driver-1',
        truck_id: 'truck-1',
        weight_tonnes: 15,
      },
    ];
    m.store.profiles = [
      { id: 'driver-1', is_digilocker_verified: true },
    ];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('CASE 1 — rejects unauthenticated requests with 401 and issues nothing', async () => {
    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(401);
    expect(m.store.wim_bypass_credentials ?? []).toHaveLength(0);
    expect(m.store.wim_measurements ?? []).toHaveLength(0);
  });

  it('CASE 2 — rejects non-driver actors with 403', async () => {
    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(CUSTOMER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(403);
    expect(m.store.wim_bypass_credentials ?? []).toHaveLength(0);
  });

  it('CASE 3 — rejects a forged safetyScore in the request body', async () => {
    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001', safetyScore: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('CASE 3b — issues PULL_IN when the server-side safety signal is unsafe', async () => {
    m.store.profiles = [{ id: 'driver-1', is_digilocker_verified: false }];

    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(200);
    expect(res.body.signal).toBe('PULL_IN');
    expect(res.body.wimPacket).toBeUndefined();
    expect(m.store.wim_bypass_credentials ?? []).toHaveLength(0);
  });

  it('CASE 4 — rejects a forged axleWeight in the request body', async () => {
    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001', axleWeight: 1000 });

    expect(res.status).toBe(400);
  });

  it('CASE 4b — issues PULL_IN when the trusted load is overweight', async () => {
    m.store.orders[0].weight_tonnes = 25; // > 20 tonne capacity

    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(200);
    expect(res.body.signal).toBe('PULL_IN');
    expect(m.store.wim_bypass_credentials ?? []).toHaveLength(0);
  });

  it('CASE 6 — rejects a load assigned to a different truck (measurement/vehicle correlation)', async () => {
    m.store.orders[0].truck_id = 'truck-2';

    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: Load is not assigned to this truck.');
    expect(m.store.wim_bypass_credentials ?? []).toHaveLength(0);
  });

  it('rejects a truck not owned by the driver', async () => {
    m.store.trucks[0].driver_id = 'driver-2';

    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(403);
    expect(m.store.wim_bypass_credentials ?? []).toHaveLength(0);
  });

  it('CASE 7 — fails closed (500, no credential) when the signing secret is missing', async () => {
    vi.stubEnv('WIM_SIGNING_SECRET', '');

    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Unable to issue bypass credential.');
    // Must not leak internal configuration details.
    expect(JSON.stringify(res.body)).not.toContain('WIM_SIGNING_SECRET');
    expect(m.store.wim_measurements ?? []).toHaveLength(0);
    expect(m.store.wim_bypass_credentials ?? []).toHaveLength(0);
  });

  it('CASE 11 — issues a signed BYPASS credential for a valid request', async () => {
    const res = await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    expect(res.status).toBe(200);
    expect(res.body.signal).toBe('BYPASS');
    expect(res.body.wimPacket).toBeDefined();
    expect(typeof res.body.wimPacket.signature).toBe('string');

    const packet = res.body.wimPacket.packet;
    expect(packet.v).toBe(WIM_PACKET_VERSION);
    expect(packet.credentialId).toBeTruthy();
    expect(packet.truckId).toBe('truck-1');
    expect(packet.bolId).toBe('BOL-001');
    expect(packet.axleWeight).toBe(30000);   // server-derived from weight_tonnes=15
    expect(packet.maxWeightLimit).toBe(40000); // server-derived from capacity 20
    expect(packet.safetyScore).toBe(100);    // server-derived from digilocker
    expect(packet.eligibility).toBe(true);
    expect(packet.expiresAt).toBeGreaterThan(packet.issuedAt);
    expect(packet.expiresAt - packet.issuedAt).toBe(15 * 60 * 1000);

    // Durably recorded for replay protection + audit.
    expect(m.store.wim_measurements).toHaveLength(1);
    expect(m.store.wim_bypass_credentials).toHaveLength(1);
    expect(m.store.wim_bypass_credentials[0].status).toBe('issued');
  });

  it('CASE 12 — writes an audit record on valid issuance', async () => {
    await request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });

    const found = await waitFor(() => (m.store.application_audit_logs ?? []).length > 0);
    expect(found).toBe(true);

    const entry = m.store.application_audit_logs.find(
      (r) => r.action === 'wim:bypass-issued' && r.metadata?.outcome === 'issued',
    );
    expect(entry).toBeDefined();
    expect(entry.resource_type).toBe('wim_bypass_credential');
    expect(entry.actor_id).toBe('driver-1');
    expect(entry.status_code).toBe(200);
    expect(entry.metadata.outcome).toBe('issued');
    expect(entry.metadata.credentialId).toBeTruthy();
    expect(entry.metadata.measurementId).toBeTruthy();
    expect(entry.metadata.truckId).toBe('truck-1');
    expect(entry.metadata.bolId).toBe('BOL-001');
    expect(entry.metadata.expiresAt).toBeTruthy();
  });
});

describe('WIM bypass — verification & replay protection (POST /api/wim/verify-bypass)', () => {
  async function issueBypass() {
    return request(buildApp())
      .post('/api/wim/request-bypass')
      .set(DRIVER_HEADERS)
      .send({ truckId: 'truck-1', bolId: 'BOL-001' });
  }

  beforeEach(() => {
    m.calls.length = 0;
    m.store.trucks = [
      { id: 'truck-1', driver_id: 'driver-1', max_capacity_tons: 20 },
    ];
    m.store.orders = [
      {
        id: 'order-1',
        order_display_id: 'BOL-001',
        driver_id: 'driver-1',
        truck_id: 'truck-1',
        weight_tonnes: 15,
      },
    ];
    m.store.profiles = [
      { id: 'driver-1', is_digilocker_verified: true },
    ];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('CASE 8 — rejects an expired credential with 403', async () => {
    const expiredCredential = {
      credentialId: 'expired-cred-1',
      measurementId: 'measure-1',
      truckId: 'truck-1',
      orderDisplayId: 'BOL-001',
      driverId: 'driver-1',
      safetyScore: 100,
      axleWeightLbs: 30000,
      capacityLbs: 40000,
      eligible: true,
      issuedAt: Date.now() - 1200000,
      expiresAt: Date.now() - 600000,
    };
    const signed = createSignedWimPacket(expiredCredential);

    const res = await request(buildApp())
      .post('/api/wim/verify-bypass')
      .set(DRIVER_HEADERS)
      .send({ wimPacket: signed });

    expect(res.status).toBe(403);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('expired-credential');
  });

  it('CASE 9 — rejects a replayed credential with 409 and consumes it exactly once', async () => {
    const issued = await issueBypass();
    expect(issued.body.signal).toBe('BYPASS');
    const { wimPacket } = issued.body;

    const first = await request(buildApp())
      .post('/api/wim/verify-bypass')
      .set(DRIVER_HEADERS)
      .send({ wimPacket });

    expect(first.status).toBe(200);
    expect(first.body.valid).toBe(true);
    expect(first.body.signal).toBe('BYPASS');

    const second = await request(buildApp())
      .post('/api/wim/verify-bypass')
      .set(DRIVER_HEADERS)
      .send({ wimPacket });

    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('credential-already-consumed');

    const record = m.store.wim_bypass_credentials.find(
      (r) => r.credential_id === wimPacket.packet.credentialId,
    );
    expect(record.status).toBe('consumed');
    expect(record.consumed_at).toBeTruthy();
  });

  it('CASE 10 — rejects a modified credential (signature mismatch)', async () => {
    const issued = await issueBypass();
    const { wimPacket } = issued.body;

    const tampered = {
      packet: { ...wimPacket.packet, axleWeight: wimPacket.packet.axleWeight + 5000 },
      signature: wimPacket.signature,
    };

    const res = await request(buildApp())
      .post('/api/wim/verify-bypass')
      .set(DRIVER_HEADERS)
      .send({ wimPacket: tampered });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('invalid-signature');
  });

  it('rejects a malformed / forged packet', async () => {
    // Empty signature is stopped at schema validation (defense in depth).
    const empty = await request(buildApp())
      .post('/api/wim/verify-bypass')
      .set(DRIVER_HEADERS)
      .send({ wimPacket: { packet: {}, signature: '' } });

    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('Validation failed');

    // A well-formed structure with a forged signature fails the HMAC check.
    const forged = await request(buildApp())
      .post('/api/wim/verify-bypass')
      .set(DRIVER_HEADERS)
      .send({ wimPacket: { packet: {}, signature: 'deadbeef' } });

    expect(forged.status).toBe(400);
    expect(forged.body.reason).toBe('invalid-signature');
  });
});
