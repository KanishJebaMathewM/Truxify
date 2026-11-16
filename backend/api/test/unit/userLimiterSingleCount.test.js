/**
 * Regression suite for issue #7149: userLimiter must count each request once.
 *
 * driverRoutes, auditRoutes and supportRoutes used to mount userLimiter twice:
 * once with router.use(userLimiter) and again inside individual route chains.
 * verifyJWT (mounted on /api in src/index.js) sets req.user before either
 * limiter runs, so both passes resolve to the same `user:<id>` key and every
 * call incremented the same counter twice. Users were throttled at roughly
 * half of USER_MAX_REQUESTS.
 *
 * The fix drops the router-level mount and keeps userLimiter on each route
 * chain. These tests pin both halves of that: no router-level userLimiter
 * layer, and exactly one userLimiter in every route, so no route silently
 * loses its per-user limit either.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { userLimiter } = vi.hoisted(() => ({
  userLimiter: function userLimiter(_req, _res, next) { next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
vi.mock('../../src/middleware/apiKey.js', () => ({ requireApiKey: (_req, _res, next) => next() }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => (_req, _res, next) => next() }));
vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
  validateParams: () => (_req, _res, next) => next(),
  validateQuery: () => (_req, _res, next) => next(),
}));
vi.mock('../../src/middleware/auditLog.js', () => ({ auditLog: () => (_req, _res, next) => next() }));
vi.mock('../../src/middleware/idempotency.js', () => ({ requireIdempotency: () => (_req, _res, next) => next() }));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({
  getAdminClient: vi.fn(),
  createUserClient: vi.fn(),
  redisClient: null,
  supabaseAdmin: null,
  supabase: null,
}));
vi.mock('../../src/services/driver/statementPayout.js', () => ({ getStatementPayout: vi.fn() }));
vi.mock('../../src/services/reputation.js', () => ({ getDriverReputation: vi.fn() }));
vi.mock('../../src/services/ml.js', () => ({ predictDriverProfit: vi.fn() }));
vi.mock('../../src/services/weighStationService.js', () => ({
  checkBypassEligibility: vi.fn(),
  syncAndTransmitInternalWeights: vi.fn(),
}));
vi.mock('../../src/services/wallet/payoutProvider.js', () => ({ isPayoutProviderConfigured: vi.fn() }));
vi.mock('../../src/controllers/driverController.js', () => ({
  default: { getDriverById: vi.fn(), getDriverTrips: vi.fn(), updateDriver: vi.fn() },
}));
vi.mock('../../src/services/auditLogService.js', () => ({ auditLogService: { query: vi.fn() } }));
vi.mock('../../src/services/auditService.js', () => ({
  queryAuditLogs: vi.fn(),
  exportAuditLogsJSON: vi.fn(),
}));
vi.mock('../../src/lib/logSigner.js', () => ({ verifyLogBatch: vi.fn() }));

/**
 * Summarises how many times userLimiter appears at router level and inside
 * each route chain of an Express router.
 */
function limiterLayout(router) {
  const routerLevel = router.stack.filter((layer) => !layer.route && layer.handle === userLimiter).length;
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      route: `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`,
      count: layer.route.stack.filter((s) => s.handle === userLimiter).length,
    }));
  return { routerLevel, routes };
}

describe('userLimiter is applied exactly once per request (#7149)', () => {
  it('driverRoutes: no router-level userLimiter, one per route', async () => {
    const { default: router } = await import('../../src/routes/driverRoutes.js');
    const { routerLevel, routes } = limiterLayout(router);

    expect(routerLevel).toBe(0);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => r.count !== 1)).toEqual([]);
  });

  it('auditRoutes: no router-level userLimiter, one per route', async () => {
    const { default: router } = await import('../../src/routes/auditRoutes.js');
    const { routerLevel, routes } = limiterLayout(router);

    expect(routerLevel).toBe(0);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => r.count !== 1)).toEqual([]);
  });

  // supportRoutes.js does not parse on main yet (duplicate `adminDb`
  // declaration, tracked in #18570), so it cannot be imported here. Check the
  // same two properties against the source until it can.
  it('supportRoutes: no router-level userLimiter, one per route (source check)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../../src/routes/supportRoutes.js'), 'utf8');

    expect(src).not.toMatch(/router\.use\(\s*userLimiter\s*\)/);

    const registrations = src.split(/\n(?=router\.(?:get|post|put|patch|delete)\()/).slice(1);
    expect(registrations.length).toBeGreaterThan(0);

    const offenders = registrations
      .map((chunk) => {
        const head = chunk.split(/\(_?req, res\) =>/)[0];
        return { route: chunk.split('\n')[0], count: (head.match(/\buserLimiter\b/g) || []).length };
      })
      .filter((r) => r.count !== 1);
    expect(offenders).toEqual([]);
  });
});
