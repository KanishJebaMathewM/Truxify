import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const circuitBreakerMock = vi.hoisted(() => ({
  setEscrowPaused: vi.fn(),
  getPauseState: vi.fn(),
}));

vi.mock('../../src/services/escrowCircuitBreaker.js', () => circuitBreakerMock);

function buildDbMock() {
  const chain = {
    count: 0,
    error: null,
    from: vi.fn(function () {
      return this;
    }),
    select: vi.fn(function () {
      return this;
    }),
    gte: vi.fn(function () {
      return Promise.resolve({ count: this.count, error: this.error });
    }),
  };
  return chain;
}

let dbMock;
vi.mock('../../src/config/db.js', () => ({
  get supabase() {
    return dbMock;
  },
  supabaseAdmin: null,
}));

const { default: internalRouter } = await import('../../src/routes/internalRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalRouter);
  return app;
}

describe('internalRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock = buildDbMock();
  });

  it('GET /escrow-velocity reports counts and pause state', async () => {
    dbMock.count = 4; // 4 x 3 queries = 12 < threshold 20
    circuitBreakerMock.getPauseState.mockResolvedValue({ paused: false, pausedAt: null });

    const res = await request(makeApp()).get('/api/internal/escrow-velocity');

    expect(res.status).toBe(200);
    expect(res.body.counts.deposits).toBe(4);
    expect(res.body.counts.total).toBe(12);
    expect(res.body.escrowPaused).toBe(false);
    expect(res.body.isAnomalyDetected).toBe(false);
  });

  it('GET /escrow-velocity flags an anomaly above the threshold', async () => {
    dbMock.count = 50;
    circuitBreakerMock.getPauseState.mockResolvedValue({ paused: true, pausedAt: 'x' });

    const res = await request(makeApp()).get('/api/internal/escrow-velocity');

    expect(res.status).toBe(200);
    expect(res.body.isAnomalyDetected).toBe(true);
    expect(res.body.escrowPaused).toBe(true);
  });

  it('GET /escrow-velocity returns 503 when no db client is configured', async () => {
    dbMock = null;
    const res = await request(makeApp()).get('/api/internal/escrow-velocity');
    expect(res.status).toBe(503);
    dbMock = buildDbMock();
  });

  it('POST /pause-escrow opens the circuit breaker', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({
      paused: true,
      updatedAt: '2026-08-11T00:00:00.000Z',
      persisted: true,
    });

    const res = await request(makeApp())
      .post('/api/internal/pause-escrow')
      .send({ paused: true });

    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
  });

  it('POST /pause-escrow closes the circuit when paused is false', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({
      paused: false,
      updatedAt: '2026-08-11T00:00:00.000Z',
      persisted: true,
    });

    const res = await request(makeApp())
      .post('/api/internal/pause-escrow')
      .send({ paused: false });

    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(false);
  });
});
