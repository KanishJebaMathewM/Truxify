import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Sentry before importing the service.
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

// Mock the logger to avoid console noise / side effects.
vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Mock the performance wrapper so methods execute inline.
vi.mock('../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

// Shared dataset returned by the mocked Supabase query builder.
let mockRows = [];

const chain = {
  select: () => chain,
  eq: () => chain,
  gte: () => chain,
  order: () => chain,
  limit: () => Promise.resolve({ data: mockRows, error: null }),
};

vi.mock('../../../src/config/db.js', () => ({
  supabase: { from: () => chain },
  supabaseAdmin: { from: () => chain },
}));

import AnomalyDetectionService from '../../../src/services/security/anomalyDetectionService.js';

describe('AnomalyDetectionService - exact amount arithmetic (#11498)', () => {
  let service;

  beforeEach(() => {
    service = new AnomalyDetectionService();
    mockRows = [];
  });

  it('computes an exact average for amounts that drift under float math', async () => {
    // Ten withdrawals of 0.1 MATIC. Float summation yields
    // 0.9999999999999999, making the average 0.09999999999999999 — not 0.1.
    // Integer accumulation must return exactly 0.1.
    mockRows = Array.from({ length: 10 }, () => ({ amount: '0.1' }));
    const avg = await service.getUserAverageWithdrawal('u1', 'w1');
    expect(avg).toBe(0.1);
  });

  it('produces an exact sum of 1.0 from ten 0.1 withdrawals', async () => {
    mockRows = Array.from({ length: 10 }, () => ({ amount: '0.1' }));
    const avg = await service.getUserAverageWithdrawal('u1', 'w1');
    expect(avg * 10).toBe(1.0);
    expect(avg * 10 === 1.0).toBe(true); // strictly equal, no float drift
  });

  it('rejects a sub-threshold withdrawal using exact threshold comparison', async () => {
    // 999.99 MATIC is below the 1000 MATIC threshold and must never be scored.
    const result = await service.detectLargeWithdrawal('u1', 'w1', {
      type: 'withdrawal',
      amount: '999.99',
    });
    expect(result).toBeNull();
  });

  it('flags a clearly anomalous large withdrawal with exact amount reported', async () => {
    mockRows = Array.from({ length: 10 }, () => ({ amount: '10' }));
    const result = await service.detectLargeWithdrawal('u1', 'w1', {
      type: 'withdrawal',
      amount: '1000',
    });
    expect(result).not.toBeNull();
    expect(result.amount).toBe(1000);
    expect(result.type).toBe('LARGE_WITHDRAWAL');
    expect(result.severity).toBe('HIGH');
  });

  it('computes an exact std dev for identical fractional amounts', async () => {
    mockRows = Array.from({ length: 5 }, () => ({ amount: '0.07' }));
    const stdDev = await service.getUserWithdrawalStdDev('u1', 'w1');
    // Variance of identical values is exactly 0.
    expect(stdDev).toBe(0);
  });
});
