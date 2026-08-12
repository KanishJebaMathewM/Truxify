import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { velocityResults, supabaseMock, circuitBreakerMock } = vi.hoisted(() => {
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
  };
});

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock,
  supabaseAdmin: null,
}));

vi.mock('../../src/services/escrowCircuitBreaker.js', () => circuitBreakerMock);

import internalRoutes from '../../src/routes/internalRoutes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal', internalRoutes);
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
  });

  it('opens the circuit when no body is supplied (defaults to paused)', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({
      paused: true,
      updatedAt: '2026-08-11T00:00:00.000Z',
      persisted: true,
    });

    const res = await request(buildApp()).post('/api/internal/pause-escrow');

    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      paused: true,
      updatedAt: '2026-08-11T00:00:00.000Z',
      persisted: true,
    });
  });

  it('opens the circuit for an explicit paused:true body', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: true, updatedAt: 't', persisted: true });
    const res = await request(buildApp()).post('/api/internal/pause-escrow').send({ paused: true });
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(true);
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
  });

  it('closes the circuit for paused:false', async () => {
    circuitBreakerMock.setEscrowPaused.mockResolvedValue({ paused: false, updatedAt: 't', persisted: true });
    const res = await request(buildApp()).post('/api/internal/pause-escrow').send({ paused: false });
    expect(circuitBreakerMock.setEscrowPaused).toHaveBeenCalledWith(false);
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
  });

  it('returns 500 when persisting the pause state fails', async () => {
    circuitBreakerMock.setEscrowPaused.mockRejectedValue(new Error('redis down'));
    const res = await request(buildApp()).post('/api/internal/pause-escrow');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to update escrow circuit breaker');
  });
});
