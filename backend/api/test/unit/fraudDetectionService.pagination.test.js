import { describe, it, expect, vi, beforeEach } from 'vitest';

// #10103-era suite targeted a (page, limit) param API — the current contract
// pages the WHOLE fraud_risk_scores table internally (PostgREST caps at 1000)
// and aggregates risk buckets. Rewritten against that contract; the service is
// a default-exported singleton (not a constructor).

let mockSupabaseAdmin;
vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return mockSupabaseAdmin; },
  redisClient: null,
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import FraudDetectionService from '../../src/services/fraud/FraudDetectionService.js';

function makePageClient(pages) {
  // pages: array of { data, error } returned per .range() call in order.
  // getFraudStats calls from() once PER PAGE — the page cursor must live on
  // the client, not the per-call chain (a chain-local cursor restarts every
  // iteration and the loop never terminates).
  const calls = [];
  const state = { idx: 0 };
  return {
    calls,
    from: vi.fn(() => {
      const chain = {
        select: vi.fn(() => chain),
        order: vi.fn(() => chain),
        range: vi.fn((from, to) => {
          calls.push([from, to]);
          const next = pages[state.idx++] ?? { data: [], error: null };
          return { then: (resolve) => resolve(next) };
        }),
      };
      return chain;
    }),
  };
}

describe('FraudDetectionService.getFraudStats — internal pagination (#10103 contract update)', () => {
  beforeEach(() => { mockSupabaseAdmin = undefined; });

  it('aggregates a single page into risk buckets', async () => {
    mockSupabaseAdmin = makePageClient([
      { data: [
        { risk_score: 0.9, created_at: '2026-01-02' },
        { risk_score: 0.5, created_at: '2026-01-01' },
        { risk_score: 0.1, created_at: '2026-01-01' },
      ], error: null },
    ]);
    const stats = await FraudDetectionService.getFraudStats();
    expect(stats.total).toBe(3);
    expect(stats.highRisk).toBe(1);
    expect(stats.mediumRisk).toBe(1);
    expect(stats.lowRisk).toBe(1);
  });

  it('pages through the whole table with .range() until a short page', async () => {
    const fullPage = Array.from({ length: 1000 }, () => ({ risk_score: 0.9, created_at: '2026-01-01' }));
    mockSupabaseAdmin = makePageClient([
      { data: fullPage, error: null },
      { data: [{ risk_score: 0.2, created_at: '2026-01-01' }], error: null },
    ]);
    const stats = await FraudDetectionService.getFraudStats();
    expect(stats.total).toBe(1001);
    expect(mockSupabaseAdmin.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it('returns zeroed stats when a page read errors', async () => {
    mockSupabaseAdmin = makePageClient([{ data: null, error: { message: 'boom' } }]);
    const stats = await FraudDetectionService.getFraudStats();
    expect(stats).toEqual({ total: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0, avgScore: 0 });
  });

  it('returns zeroed stats when supabaseAdmin is unavailable', async () => {
    mockSupabaseAdmin = undefined;
    const stats = await FraudDetectionService.getFraudStats();
    expect(stats.total).toBe(0);
  });
});
