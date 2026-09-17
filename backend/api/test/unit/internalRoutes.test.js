import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import logger from '../../src/middleware/logger.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@sentry/node', () => ({
  withScope: (fn) => fn({ setTag: vi.fn(), setExtra: vi.fn() }),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const { velocityResults, supabaseMock, circuitBreakerMock, escrowServiceMock } = vi.hoisted(() => {
  const velocityResults = {};
  return {
    velocityResults,
    supabaseMock: {
      from: () => ({
        select: () => ({
          gte: (column) =>
            Promise.resolve(velocityResults[column] ?? { count: 0, error: null }),
        }),
      }),
    },
    circuitBreakerMock: {
      setEscrowPaused: vi.fn(),
      getPauseState: vi.fn(),
    },
    escrowServiceMock: {
      setEscrowContractPaused: vi.fn(),
    },
  };
});

// internalRoutes reads through supabaseAdmin (getDbClient), not the anon
// client, so both handles must be mocked or every velocity query short-circuits
// to the 503 "Supabase is not configured" branch.
vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock,
  supabaseAdmin: supabaseMock,
}));

vi.mock('../../src/services/escrowCircuitBreaker.js', () => circuitBreakerMock);

vi.mock('../../src/services/escrow.js', () => escrowServiceMock);

import internalRoutes from '../../src/routes/internalRoutes.js';
import { requireApiKey, authConfig } from '../../src/middleware/apiKey.js';

function buildApp() {
  process.env.ESCROW_OPERATOR_API_KEYS = VALID_KEY;
  const app = express();
  app.use(express.json());
  app.use('/api/internal', (req, _res, next) => {
    req.apiKeyMetadata = { rawKey: VALID_KEY };
    next();
  });
  app.use('/api/internal', internalRoutes);
  return app;
}

const VALID_KEY = 'internal-test-key';
// The dedicated escrow operator key. Per the documented configuration it is
// also listed in VALID_API_KEYS, because requireApiKey authenticates it
// before the route-level operator check runs.
const OPERATOR_KEY = 'escrow-operator-test-key';

/**
 * Mirrors the real mount in src/index.js:
 *
 *   app.use('/api/internal', requireApiKey, internalRoutes)
 *
 * together with the documented operator configuration (the dedicated key is
 * listed in VALID_API_KEYS and designated via ESCROW_OPERATOR_API_KEY), so
 * the auth assertions below exercise the middleware chain that actually
 * guards these routes in production rather than a stand-in.
 */
function buildGuardedApp({ operatorConfigured = true } = {}) {
  process.env.VALID_API_KEYS = `${VALID_KEY},${OPERATOR_KEY}`;
  if (operatorConfigured) {
    process.env.ESCROW_OPERATOR_API_KEY = OPERATOR_KEY;
  } else {
    delete process.env.ESCROW_OPERATOR_API_KEY;
  }
  authConfig.reload();
  const app = express();
  app.use(express.json());
  app.use('/api/internal', requireApiKey, internalRoutes);
  return app;
}

describe('GET /api/internal/escrow-velocity', () => {
  beforeEach(() => {
    delete velocityResults['escrow_deposited_at'];
    delete velocityResults['escrow_released_at'];
    delete velocityResults['escrow_refunded_at'];
    circuitBreakerMock.getPauseState.mockResolvedValue({ paused: false, pausedAt: null });
  });

  it('reports no anomaly when the combined count is below the threshold', async () => {
    velocityResults['escrow_deposited_at'] = { count: 5, error: null };
    velocityResults['escrow_released_at'] = { count: 3, error: null };
    velocityResults['escrow_refunded_at'] = { count: 2, error: null };

    const res = await request(buildApp()).get('/api/internal/escrow-velocity');

    expect(res.status).toBe(200);
    expect(res.body.isAnomalyDetected).toBe(false);
    expect(res.body.counts).toEqual({ deposits: 5, releases: 3, refunds: 2, total: 10 });
  });

  it('detects an anomaly and reports the circuit state when the threshold is hit', async () => {
    velocityResults['escrow_deposited_at'] = { count: 30, error: null };
    velocityResults['escrow_released_at'] = { count: 0, error: null };
    velocityResults['escrow_refunded_at'] = { count: 0, error: null };
    circuitBreakerMock.getPauseState.mockResolvedValue({ paused: true, pausedAt: '2026-08-11T00:00:00.000Z' });

    const res = await request(buildApp()).get('/api/internal/escrow-velocity');

    expect(res.status).toBe(200);
    expect(res.body.isAnomalyDetected).toBe(true);
    expect(res.body.escrowPaused).toBe(true);
    expect(res.body.pausedAt).toBe('2026-08-11T00:00:00.000Z');
  });
});

describe('POST /api/internal/pause-escrow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // These route-logic tests exercise the handler directly (no requireApiKey
    // mount); unpause tests below present the operator key itself.
    process.env.ESCROW_OPERATOR_API_KEY = OPERATOR_KEY;
  });

  afterEach(() => {
    delete process.env.ESCROW_OPERATOR_API_KEY;
  });

  it('opens the circuit when no body is supplied (defaults to paused)', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({
      paused: true,
      updatedAt: '2026-08-11T00:00:00.000Z',
      persisted: true,
    });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ success: true, txHash: '0xabc' });

    const res = await request(buildApp()).post('/api/internal/pause-escrow');

    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
    expect(escrowServiceMock.setEscrowContractPaused).toHaveBeenCalledWith(true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      paused: true,
      updatedAt: '2026-08-11T00:00:00.000Z',
      persisted: true,
      onChain: {
        success: true,
        txHash: '0xabc'
      }
    });
  });

  it('opens the circuit for an explicit paused:true body', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: true, updatedAt: 't', persisted: true });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ success: true, txHash: '0xabc' });
    const res = await request(buildApp()).post('/api/internal/pause-escrow').send({ paused: true });
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
    expect(escrowServiceMock.setEscrowContractPaused).toHaveBeenCalledWith(true);
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
    expect(res.body.onChain.txHash).toBe('0xabc');
  });

  it('closes the circuit for paused:false when the operator key is presented', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: false, updatedAt: 't', persisted: true });
    const res = await request(buildApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', OPERATOR_KEY)
      .send({ paused: false });
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(false);
    expect(escrowServiceMock.setEscrowContractPaused).toHaveBeenCalledWith(false);
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
  });

  it('returns 502 with correct message if on-chain pause fails after Redis succeeds', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: true, updatedAt: 't', persisted: true });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ error: 'Reverted' });
    const res = await request(buildApp()).post('/api/internal/pause-escrow');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Redis pause completed, but on-chain pause failed.');
  });

  it('returns 502 with correct message if on-chain unpause fails', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: false, updatedAt: 't', persisted: true });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ error: 'Reverted' });
    const res = await request(buildApp()).post('/api/internal/pause-escrow').send({ paused: false });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Redis unpause completed, but on-chain unpause failed.');
  });

  it('returns 502 with correct message if on-chain pause fails after Redis fails', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: true, updatedAt: 't', persisted: false });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ error: 'Reverted' });
    const res = await request(buildApp()).post('/api/internal/pause-escrow');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Redis pause failed, but on-chain pause failed.');
  });

  it('returns 200 with persisted:false when Redis fails but on-chain succeeds', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: true, updatedAt: 'now', persisted: false });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ success: true, txHash: '0xabc' });
    const res = await request(buildApp()).post('/api/internal/pause-escrow');
    expect(res.status).toBe(200);
    expect(res.body.persisted).toBe(false);
    expect(res.body.onChain.success).toBe(true);
  });

  it('returns 500 when persisting the pause state fails', async () => {
    circuitBreakerMock.setEscrowPaused.mockRejectedValue(new Error('redis down'));
    const res = await request(buildApp()).post('/api/internal/pause-escrow');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to update escrow circuit breaker');
  });

  it('closes the circuit for a stringified "false" body when the operator key is presented', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: false, updatedAt: 't', persisted: true });
    const res = await request(buildApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', OPERATOR_KEY)
      .send({ paused: 'false' });
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(false);
    expect(escrowServiceMock.setEscrowContractPaused).toHaveBeenCalledWith(false);
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
  });

  it('rejects a valid non-operator API key', async () => {
    const res = await request(buildGuardedApp(`${VALID_KEY},reader-key`))
      .post('/api/internal/pause-escrow')
      .set('x-api-key', 'reader-key')
      .send({ paused: false });

    expect(res.status).toBe(403);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });
});

// Closing the circuit re-enables on-chain escrow submissions, so the unpause
// direction is gated on a dedicated operator key on top of requireApiKey.
describe('POST /api/internal/pause-escrow operator authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // velocityResults is shared module state seeded by the escrow-velocity
    // tests above; clear it so the telemetry check below sees a clean window.
    delete velocityResults['escrow_deposited_at'];
    delete velocityResults['escrow_released_at'];
    delete velocityResults['escrow_refunded_at'];
    circuitBreakerMock.getPauseState.mockResolvedValue({ paused: false, pausedAt: null });
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({
      paused: false,
      updatedAt: '2026-09-16T00:00:00.000Z',
      persisted: true,
    });
  });

  afterEach(() => {
    delete process.env.ESCROW_OPERATOR_API_KEY;
  });

  it('answers 403 and leaves the breaker untouched when a normal internal API key unpauses', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', VALID_KEY)
      .send({ paused: false });

    expect(res.status).toBe(403);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('answers 403 for a stringified "false" body from a normal internal API key', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', VALID_KEY)
      .send({ paused: 'false' });

    expect(res.status).toBe(403);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('closes the circuit when the dedicated operator key unpauses', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', OPERATOR_KEY)
      .send({ paused: false });

    expect(res.status).toBe(200);
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(false);
    expect(res.body).toEqual({
      paused: false,
      updatedAt: '2026-09-16T00:00:00.000Z',
      persisted: true,
    });
  });

  it('keeps opening the circuit available to a normal internal API key (paused:true)', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: true, updatedAt: 't', persisted: true });

    const res = await request(buildGuardedApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', VALID_KEY)
      .send({ paused: true });

    expect(res.status).toBe(200);
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
    expect(res.body.paused).toBe(true);
  });

  it('keeps telemetry readable by a normal internal API key', async () => {
    const res = await request(buildGuardedApp())
      .get('/api/internal/escrow-velocity')
      .set('x-api-key', VALID_KEY);

    expect(res.status).toBe(200);
    expect(res.body.isAnomalyDetected).toBe(false);
  });

  it('fails closed with 403 when ESCROW_OPERATOR_API_KEY is not configured', async () => {
    const res = await request(buildGuardedApp({ operatorConfigured: false }))
      .post('/api/internal/pause-escrow')
      .set('x-api-key', VALID_KEY)
      .send({ paused: false });

    expect(res.status).toBe(403);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('fails closed even when the unconfigured operator key value is presented', async () => {
    // The key value is still in VALID_API_KEYS (so requireApiKey admits it),
    // but with the operator designation gone nothing may unpause.
    const res = await request(buildGuardedApp({ operatorConfigured: false }))
      .post('/api/internal/pause-escrow')
      .set('x-api-key', OPERATOR_KEY)
      .send({ paused: false });

    expect(res.status).toBe(403);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('returns 401 and leaves the breaker untouched when the API key is missing', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/pause-escrow')
      .send({ paused: false });

    expect(res.status).toBe(401);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('returns 401 and leaves the breaker untouched when the API key is invalid', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', 'not-the-key')
      .send({ paused: false });

    expect(res.status).toBe(401);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('never leaks the raw operator key into the auth-failure log', async () => {
    await request(buildGuardedApp())
      .post('/api/internal/pause-escrow')
      .set('x-api-key', VALID_KEY)
      .send({ paused: false });

    for (const call of logger.warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(OPERATOR_KEY);
    }
  });
});

// #13925 — the security sentinel workflow POSTs here when it matches a
// flash-loan/frontrun pattern in the Polygon mempool.
describe('POST /api/internal/defensive-pause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({
      paused: true,
      updatedAt: '2026-08-14T00:00:00.000Z',
      persisted: true,
    });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ success: true, txHash: '0xdef' });
  });

  it('rejects an unauthenticated call without touching the circuit breaker', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .send({ reason: 'attacker' });

    expect(res.status).toBe(401);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('rejects a wrong API key without touching the circuit breaker', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', 'not-the-key')
      .send({});

    expect(res.status).toBe(401);
    expect(circuitBreakerMock.setEscrowPaused).not.toHaveBeenCalled();
  });

  it('opens the circuit for an authenticated sentinel call', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', VALID_KEY)
      .send({ reason: 'gasPrice > 500 gwei', txHash: '0xabc' });

    expect(res.status).toBe(200);
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
    expect(escrowServiceMock.setEscrowContractPaused).toHaveBeenCalledWith(true);
    expect(res.body).toEqual({
      paused: true,
      updatedAt: '2026-08-14T00:00:00.000Z',
      persisted: true,
      source: 'security-sentinel',
      onChain: {
        success: true,
        txHash: '0xdef'
      }
    });
  });

  it('is one-way: a paused:false body still opens the circuit', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', VALID_KEY)
      .send({ paused: false });

    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
    expect(escrowServiceMock.setEscrowContractPaused).toHaveBeenCalledWith(true);
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
    expect(res.body.onChain.txHash).toBe('0xdef');
  });

  it('returns 500 when persisting the pause state fails completely', async () => {
    circuitBreakerMock.setEscrowPaused.mockRejectedValue(new Error('redis down'));

    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', VALID_KEY)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to apply defensive pause');
  });

  it('returns 502 if on-chain defensive pause fails (Redis succeeded)', async () => {
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ error: 'Escrow contract is not initialised' });
    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', VALID_KEY)
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('processed in Redis');
    expect(res.body.onChainError).toBe('Escrow contract is not initialised');
  });

  it('returns 502 if on-chain defensive pause fails (Redis also failed)', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: true, updatedAt: 'now', persisted: false });
    escrowServiceMock.setEscrowContractPaused.mockResolvedValue({ error: 'Reverted' });
    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', VALID_KEY)
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('failed off-chain');
  });

  it('reports 503 with updated message if on-chain succeeds but Redis fails (persisted=false)', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({
      paused: true,
      updatedAt: '2026-08-14T00:00:00.000Z',
      persisted: false,
    });

    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', VALID_KEY)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('Defensive pause succeeded on-chain, but Redis is down');
    expect(res.body.paused).toBe(true);
    expect(res.body.persisted).toBe(false);
    expect(res.body.onChain.txHash).toBe('0xdef');
  });

  it('is reachable at all — the route exists rather than falling through to 404', async () => {
    const res = await request(buildGuardedApp())
      .post('/api/internal/defensive-pause')
      .set('x-api-key', VALID_KEY)
      .send({});

    expect(res.status).not.toBe(404);
  });
});
