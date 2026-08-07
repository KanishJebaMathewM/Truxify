/**
 * Unit tests for backend/api/src/routes/blockchainMonitoringRoutes.js
 *
 * These routes were previously unreachable: the router was never mounted and
 * its req.* dependencies (blockchainMetrics, escalationHandler, supabase)
 * were never attached. These tests mount the router with mocked dependencies
 * and assert every endpoint responds with the expected payload.
 *
 * Run with:  npm test -- test/unit/blockchainMonitoringRoutes.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import blockchainMonitoringRoutes from '../../src/routes/blockchainMonitoringRoutes.js';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  app.use('/api/blockchain', (req, _res, next) => {
    req.blockchainMetrics = deps.blockchainMetrics;
    req.escalationHandler = deps.escalationHandler;
    req.supabase = deps.supabase;
    next();
  });
  app.use('/api/blockchain', blockchainMonitoringRoutes);
  return app;
}

function buildSupabaseStub() {
  const calls = [];
  const chain = {
    select() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    eq(column, value) {
      calls.push({ column, value });
      return chain;
    },
    single() { return chain; },
    then(resolve, reject) {
      return Promise.resolve(resolve({ data: [], error: null })).catch(reject);
    },
  };
  return {
    from: vi.fn(() => chain),
    calls,
  };
}

describe('blockchainMonitoringRoutes', () => {
  let metrics;
  let escalationHandler;
  let supabase;

  beforeEach(() => {
    metrics = {
      getMetrics: vi.fn(() => ({
        contractCallSuccessRate: 100,
        failedTransactionCount: 0,
      })),
    };
    escalationHandler = {
      getActiveAlerts: vi.fn(async () => [{ alertId: 'abc123', resolved: false }]),
      resolveAlert: vi.fn(async () => true),
    };
    supabase = buildSupabaseStub();
  });

  it('GET /api/blockchain/metrics returns the metrics payload', async () => {
    const res = await request(buildApp({ blockchainMetrics: metrics, escalationHandler, supabase }))
      .get('/api/blockchain/metrics');

    expect(res.status).toBe(200);
    expect(res.body.metrics.contractCallSuccessRate).toBe(100);
    expect(res.body.timestamp).toBeTruthy();
  });

  it('GET /api/blockchain/alerts/active returns active alerts', async () => {
    const res = await request(buildApp({ blockchainMetrics: metrics, escalationHandler, supabase }))
      .get('/api/blockchain/alerts/active');

    expect(res.status).toBe(200);
    expect(res.body.activeAlerts).toEqual([{ alertId: 'abc123', resolved: false }]);
    expect(res.body.count).toBe(1);
  });

  it('POST /api/blockchain/alerts/:alertId/resolve resolves an alert', async () => {
    const res = await request(buildApp({ blockchainMetrics: metrics, escalationHandler, supabase }))
      .post('/api/blockchain/alerts/abc123/resolve');

    expect(res.status).toBe(200);
    expect(res.body.alertId).toBe('abc123');
    expect(escalationHandler.resolveAlert).toHaveBeenCalledWith('abc123');
  });

  it('GET /api/blockchain/events queries blockchain_monitoring_events through the attached supabase client', async () => {
    const res = await request(buildApp({ blockchainMetrics: metrics, escalationHandler, supabase }))
      .get('/api/blockchain/events?type=PAYMENT_RECEIVED&severity=CRITICAL&limit=10');

    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith('blockchain_monitoring_events');
    expect(supabase.calls).toEqual([
      { column: 'type', value: 'PAYMENT_RECEIVED' },
      { column: 'severity', value: 'CRITICAL' },
    ]);
    expect(res.body.count).toBe(0);
  });

  it('GET /api/blockchain/escalations/:alertId reads blockchain_escalations through the attached supabase client', async () => {
    const app = buildApp({ blockchainMetrics: metrics, escalationHandler, supabase });
    supabase.from.mockImplementationOnce(() => {
      const chain = {
        select() { return chain; },
        eq(column, value) {
          supabase.calls.push({ column, value });
          return chain;
        },
        single() { return chain; },
        then(resolve) {
          return Promise.resolve(resolve({
            data: { alert_id: 'abc123', resolved: false },
            error: null,
          }));
        },
      };
      return chain;
    });

    const res = await request(app).get('/api/blockchain/escalations/abc123');

    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith('blockchain_escalations');
    expect(res.body.escalation.alert_id).toBe('abc123');
  });
});
