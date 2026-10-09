import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, rows, noop } = vi.hoisted(() => {
  const rows = [
    { id: 'bid', bid_amount: '900000', total_amount: '1090000', base_freight: '1000000', toll_estimate: '40000', platform_fee: '50000' },
    { id: 'total', bid_amount: null, total_amount: '1090000', base_freight: '1000000', toll_estimate: '40000', platform_fee: '50000' },
    { id: 'zero', bid_amount: 0, total_amount: 100, base_freight: 100, toll_estimate: 10, platform_fee: 5 },
    { id: 'legacy', base_freight: 1000, toll_estimate: 40, platform_fee: 50 },
  ].map(row => ({ pickup_date: '2026-09-01', status: 'payment_released', ...row }));
  const db = { from: vi.fn(table => {
    let columns = [];
    const chain = {
      select: vi.fn(value => { columns = value.split(',').map(s => s.trim()); return chain; }),
      eq: vi.fn(() => chain), in: vi.fn(() => chain), order: vi.fn(() => chain),
      range: vi.fn(() => chain), gte: vi.fn(() => chain), lte: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: { full_name: 'Driver', phone: '123' }, error: null })),
      then: resolve => resolve({ data: table === 'orders'
        ? rows.map(row => Object.fromEntries(columns.map(key => [key, row[key]]))) : [], error: null }),
    };
    return chain;
  }) };
  return { db, rows, noop: (_req, _res, next) => next() };
});
vi.mock('../../src/config/db.js', () => ({
  supabase: db, supabaseAdmin: db, getAdminClient: () => db, createUserClient: () => db, redisClient: null,
}));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: noop }));
vi.mock('../../src/middleware/apiKey.js', () => ({ requireApiKey: noop }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => noop }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: noop }));
vi.mock('../../src/middleware/validate.js', () => ({ validateBody: () => noop, validateQuery: () => noop, validateParams: () => noop }));
vi.mock('../../src/middleware/auditLog.js', () => ({ auditLog: () => noop }));
vi.mock('../../src/middleware/idempotency.js', () => ({ requireIdempotency: () => noop }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('express-rate-limit', () => ({ default: () => noop }));
vi.mock('../../src/services/reputation.js', () => ({ getDriverReputation: vi.fn() }));
vi.mock('../../src/services/ml.js', () => ({ predictDriverProfit: vi.fn() }));
vi.mock('../../src/services/weighStationService.js', () => ({ checkBypassEligibility: vi.fn(), syncAndTransmitInternalWeights: vi.fn() }));
vi.mock('../../src/services/wallet/payoutProvider.js', () => ({ isPayoutProviderConfigured: () => true }));
vi.mock('../../src/controllers/driverController.js', () => ({ default: new Proxy({}, { get: () => noop }) }));
vi.mock('../../src/services/profileService.js', () => ({ getProfile: vi.fn(), getCustomerStats: vi.fn(), getDriverDetails: vi.fn() }));
vi.mock('../../src/models/ProfileModel.js', () => ({ ProfileModel: class {} }));
vi.mock('../../src/lib/profileCache.js', () => ({ invalidateCachedProfile: vi.fn(), invalidateCachedSupabaseProfileAll: vi.fn(), invalidateProfileCache: vi.fn() }));

import driverRoutes from '../../src/routes/driverRoutes.js';
import profileRoutes from '../../src/routes/profileRoutes.js';

describe('statement payout basis', () => {
  beforeEach(() => vi.clearAllMocks());
  const endpoints = [
    ['driver statement', driverRoutes, '/statement'],
    ['driver earnings report', driverRoutes, '/earnings/report'],
    ['profile statement', profileRoutes, '/driver/statement'],
  ];
  async function run(router, path, query = {}) {
    const route = router.stack.find(layer => layer.route?.path === path).route;
    const handler = route.stack.at(-1).handle;
    const res = { json: vi.fn(), status: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
    res.status.mockReturnValue(res);
    await handler({ user: { id: 'driver' }, query }, res);
    expect(res.status).not.toHaveBeenCalled();
    return res;
  }
  for (const [name, router, path] of endpoints) {
    it(`${name} matches negotiated wallet payout and total-amount fallback`, async () => {
      const res = await run(router, path, { sort_by: 'net_earnings' });
      const result = res.json.mock.calls[0][0];
      expect(result.trips.map(row => [row.id, row.net_earnings])).toEqual([
        ['total', 1090000], ['bid', 900000], ['legacy', 1090], ['zero', 0],
      ]);
      expect(result.summary.total_net_earnings).toBe(1991090);
      expect(result.summary.total_platform_fees).toBe(100055);
      expect(rows[0].bid_amount).toBe('900000');
    });
    it(`${name} exports the same payout amounts in CSV`, async () => {
      const res = await run(router, path, { format: 'csv', sort_by: 'net_earnings' });
      const lines = res.send.mock.calls[0][0].split('\n');
      expect(lines).toHaveLength(5);
      expect(lines[1]).toContain(',"1090000",');
      expect(lines[2]).toContain(',"900000",');
      expect(lines[3]).toContain(',"1090",');
      expect(lines[4]).toContain(',"0",');
    });
  }
});
