import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => {
  const chain = () => ({
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  });
  return {
    supabase: { from: () => chain() },
    supabaseAdmin: { from: () => chain() },
    firebaseAdmin: null,
    mongoDb: null,
    redisClient: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
      call: () => Promise.resolve(1),
      status: 'ready',
    },
    upstashRedisClient: null,
  };
});

import * as crossDockService from '../../src/services/order/crossDockService.js';
import { haversineKm } from '../../src/services/order/crossDockService.js';

describe('crossDockService load regression', () => {
  it('module parses and exports every function mounted by crossDockRoutes', () => {
    const required = [
      'findHandoffCandidates',
      'createTransferRequest',
      'acceptTransferRequest',
      'declineTransferRequest',
      'cancelTransferRequest',
      'verifyHandoff',
      'getTransfer',
      'listTransfers',
    ];
    for (const name of required) {
      expect(typeof crossDockService[name]).toBe('function');
    }
  });

  it('re-exports the haversineKm helper and computes a sane distance', () => {
    expect(typeof haversineKm).toBe('function');
    const distance = haversineKm(19.076, 72.8777, 19.076, 72.8777);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeCloseTo(0, 1);
  });
});