import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// auth.js is mid-splice-repair on main (#18283) — stub authenticate so this
// suite is independent of that fix.
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u-test', role: 'customer' }; next(); },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({
  supabase: null, supabaseAdmin: null, redisClient: null, upstashRedisClient: null,
}));

const relayRoutes = (await import('../../src/routes/relayRoutes.js')).default;

const app = express();
app.use(express.json());
app.use('/api/relay', relayRoutes);

describe('relayRoutes', () => {
  it('GET /hubs returns the transshipment registry', async () => {
    const res = await request(app).get('/api/relay/hubs');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalHubs).toBeGreaterThan(3);
    expect(res.body.data[0]).toHaveProperty('lat');
    expect(res.body.data[0]).toHaveProperty('radiusMeters');
  });

  it('POST /plan 400s without coordinates', async () => {
    const res = await request(app).post('/api/relay/plan').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/coordinates/);
  });

  it('POST /plan returns a corridor plan for a long haul', async () => {
    const res = await request(app).post('/api/relay/plan').send({
      origin: { lat: 28.6139, lng: 77.209, address: 'Delhi' },
      destination: { lat: 13.0827, lng: 80.2707, address: 'Chennai' },
      totalAmount: 300000,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.legs.length).toBeGreaterThan(1);
    const shareSum = res.body.data.legs.reduce((s, l) => s + l.payoutSharePercentage, 0);
    expect(shareSum).toBeGreaterThan(99);
  });

  it('POST /plan short-haul returns a single direct leg', async () => {
    const res = await request(app).post('/api/relay/plan').send({
      origin: { lat: 28.61, lng: 77.20, address: 'A' },
      destination: { lat: 28.70, lng: 77.30, address: 'B' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.isRelayApplicable).toBe(false);
    expect(res.body.data.legs).toHaveLength(1);
  });
});
