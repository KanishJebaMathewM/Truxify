import { beforeEach, describe, expect, it, vi } from 'vitest';
const { validationCalls, noop, db } = vi.hoisted(() => ({
  validationCalls: vi.fn(), noop: (_req, _res, next) => next(), db: {},
}));
vi.mock('../../src/config/db.js', () => ({ supabase: db, getAdminClient: () => db, createUserClient: () => db, redisClient: null }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (req, res, next) => {
  if (!req.authUser) return res.status(401).json({ error: 'Authentication required' });
  req.user = req.authUser; next();
} }));
vi.mock('../../src/middleware/apiKey.js', () => ({ requireApiKey: noop }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => (req, res, next) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Forbidden' });
  next();
} }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: noop }));
vi.mock('../../src/middleware/validate.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, validateBody: schema => {
    const validate = actual.validateBody(schema);
    return (req, res, next) => { validationCalls(); return validate(req, res, next); };
  } };
});
vi.mock('../../src/middleware/auditLog.js', () => ({ auditLog: () => noop }));
vi.mock('../../src/middleware/idempotency.js', () => ({ requireIdempotency: () => noop }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('express-rate-limit', () => ({ default: () => noop }));
vi.mock('../../src/services/reputation.js', () => ({ getDriverReputation: vi.fn() }));
vi.mock('../../src/services/ml.js', () => ({ predictDriverProfit: vi.fn() }));
vi.mock('../../src/services/weighStationService.js', () => ({ checkBypassEligibility: vi.fn(), syncAndTransmitInternalWeights: vi.fn() }));
vi.mock('../../src/services/wallet/payoutProvider.js', () => ({ isPayoutProviderConfigured: () => true }));
vi.mock('../../src/controllers/driverController.js', () => ({ default: new Proxy({}, { get: () => noop }) }));

import driverRoutes from '../../src/routes/driverRoutes.js';
const route = driverRoutes.stack.find(layer => layer.route?.path === '/weigh-stations/sync-weight').route;
// Exercise the registered gate chain with the real Zod validation middleware;
// the downstream weight/ownership handler is outside this ordering regression.
async function gates(authUser, body) {
  const req = { authUser, body };
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  let passed = true;
  for (const layer of route.stack.slice(0, -1)) {
    let proceed = false;
    await layer.handle(req, res, () => { proceed = true; });
    if (!proceed) { passed = false; break; }
  }
  return { res, passed };
}
describe('weight sync authentication before validation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects unauthenticated malformed input without validating it', async () => {
    const { res, passed } = await gates(undefined, {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(validationCalls).not.toHaveBeenCalled();
    expect(passed).toBe(false);
  });
  it('rejects unauthorized malformed input without validating it', async () => {
    const { res, passed } = await gates({ id: 'customer', role: 'customer' }, {});
    expect(res.status).toHaveBeenCalledWith(403);
    expect(validationCalls).not.toHaveBeenCalled();
    expect(passed).toBe(false);
  });
  it('still validates an authorized malformed request once', async () => {
    const { res, passed } = await gates({ id: 'driver', role: 'driver' }, {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(validationCalls).toHaveBeenCalledTimes(1);
    expect(passed).toBe(false);
  });
  it('lets an authorized valid request through after exactly one validation', async () => {
    const { res, passed } = await gates({ id: 'driver', role: 'driver' }, {
      vehicleId: 'vehicle', truckId: 'truck', axles: [{ position: 0, pressure_psi: 80 }],
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(validationCalls).toHaveBeenCalledTimes(1);
    expect(passed).toBe(true);
  });
});
