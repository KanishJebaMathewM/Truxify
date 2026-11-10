import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const context = vi.hoisted(() => ({ user: { id: 'carrier-one', role: 'carrier' } }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = context.user; next(); },
}));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: (_req, _res, next) => next() }));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import router from '../../src/routes/carbonTokenRoutes.js';
import { carbonTokenService } from '../../src/services/carbonTokenService.js';

const app = express();
app.use(express.json());
app.use('/api/carbon-credits', router);
const payload = { truck_id: 'TR-1', trip_id: 'TP-1', fuel_saved_liters: 12 };
async function mint() {
  const response = await request(app).post('/api/carbon-credits/mint').send(payload);
  expect(response.status).toBe(201);
  return response.body.token;
}

describe('carbon mint ownership through the real router and service', () => {
  beforeEach(() => {
    carbonTokenService.tokens.clear();
    context.user = { id: 'carrier-one', role: 'carrier' };
  });

  it('records the authenticated owner, ignoring a body-supplied owner', async () => {
    const response = await request(app).post('/api/carbon-credits/mint')
      .send({ ...payload, ownerId: 'victim', owner_id: 'victim' });
    expect(response.status).toBe(201);
    expect(response.body.token.ownerId).toBe('carrier-one');
    expect(await carbonTokenService.getTokenDetails(response.body.token.tokenId, 'carrier-one'))
      .toMatchObject({ ownerId: 'carrier-one' });
  });

  it('allows the owner and admin to read but returns 404 to another carrier', async () => {
    const token = await mint();
    const path = `/api/carbon-credits/${token.tokenId}`;
    expect((await request(app).get(path)).status).toBe(200);
    context.user = { id: 'carrier-two', role: 'carrier' };
    expect((await request(app).get(path)).status).toBe(404);
    context.user = { id: 'admin-one', role: 'admin' };
    expect((await request(app).get(path)).status).toBe(200);
  });

  it('prevents a different buyer from retiring the minted record', async () => {
    const token = await mint();
    context.user = { id: 'shipper-two', role: 'shipper' };
    const response = await request(app).post('/api/carbon-credits/purchase').send({
      token_id: token.tokenId,
      buyer_address: '0x1234567890abcdef1234567890abcdef12345678',
    });
    // The existing route maps permission errors to 500; this regression only
    // verifies that retirement is refused and the record remains unchanged.
    expect(response.status).toBe(500);
    expect(carbonTokenService.tokens.get(token.tokenId).status).toBe('PENDING_CHAIN_ANCHOR');
    expect(carbonTokenService.tokens.get(token.tokenId)).not.toHaveProperty('buyerAddress');
  });
});
