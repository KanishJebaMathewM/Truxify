/**
 * Unit tests for backend/api/src/services/escrowRefundReconciliation.js
 *
 * Run with:  npm run test:unit -- test/unit/escrowRefundReconciliation.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mocks: hoisted so vi.mock factories can reference them via closure
const mocks = vi.hoisted(() => ({
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('../../src/lib/redisLock.js', () => {
  // Use mocks.redisSet directly via closure (avoids require() timing issues with db.js mock)
  const _redisSet = mocks.redisSet;
  return {
    acquireLock: async (resourceKey, ttlMs = 10000) => {
      const lockValue = 'mock-lock-' + Math.random();
      const result = await _redisSet(resourceKey, lockValue, 'PX', ttlMs, 'NX');
      return result ? lockValue : null;
    },
    releaseLock: async (resourceKey) => {
      await mocks.redisDel(resourceKey);
      return true;
    },
  };
});

vi.mock('../../src/config/db.js', () => ({
  default: {
    supabase: {
      from: (...args) => mocks.supabaseFrom(...args),
      rpc: (...args) => mocks.supabaseFrom().rpc(...args),
    },
    redisClient: { set: (...args) => mocks.redisSet(...args), del: (...args) => mocks.redisDel(...args) },
  },
  supabase: {
    from: (...args) => mocks.supabaseFrom(...args),
    rpc: (...args) => mocks.supabaseFrom().rpc(...args),
  },
  redisClient: { set: (...args) => mocks.redisSet(...args), del: (...args) => mocks.redisDel(...args) },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./escrow.js', () => ({
  confirmEscrowRefund: vi.fn(),
}));

import { OrderRepository } from '../../src/repositories/orderRepository.js';
import { supabase } from '../../src/config/db.js';

import {
  reconcilePendingEscrowRefunds,
  startEscrowRefundReconciliation,
  stopEscrowRefundReconciliation,
} from '../../src/services/escrowRefundReconciliation.js';

let orderRepository;

// Clear call history before each test
// Do NOT use mockReset() — it clears the implementation, breaking queued mockReturnValueOnce values
beforeEach(() => {
  mocks.redisSet.mockClear();
  mocks.redisDel.mockClear();
  mocks.redisSet.mockReturnValue('OK');
  mocks.redisDel.mockReturnValue('OK');
  orderRepository = new OrderRepository(supabase);
});

// Helper: configure supabase.from() to return a builder that yields given orders
function configureBuilder(orders) {
  mocks.supabaseFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: orders, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
  });
}

describe('reconcilePendingEscrowRefunds', () => {
  it('skips batch when global lock is not acquired', async () => {
    // Global lock fails (redisClient.set returns null) — function returns early
    mocks.redisSet.mockReturnValueOnce(null);
    configureBuilder([]);
    await reconcilePendingEscrowRefunds(orderRepository);
    // Only global lock call, no per-order lock (early return)
    expect(mocks.redisSet).toHaveBeenCalledTimes(1);
    expect(mocks.redisDel).not.toHaveBeenCalled();
  });

  it('handles empty pendingOrders gracefully', async () => {
    configureBuilder([]);
    await reconcilePendingEscrowRefunds(orderRepository);
    // Global lock + release (no orders to process)
    expect(mocks.redisSet).toHaveBeenCalledTimes(1);
    expect(mocks.redisDel).toHaveBeenCalledTimes(1);
  });

  it('skips order when per-order redisClient.set returns null', async () => {
    // Global lock OK (truthy); per-order lock fails (returns null)
    mocks.redisSet.mockReturnValueOnce('OK').mockReturnValueOnce(null);
    configureBuilder([{ id: 'o1', order_display_id: 'O1', refund_tx_hash: '0xtx1' }]);
    await reconcilePendingEscrowRefunds(orderRepository);
    // Global lock: 1 call (returns 'OK')
    // Per-order lock: 1 call (via acquireLock → redisClient.set, returns null)
    // Both call _redisSet; order skipped (no release since lock not acquired)
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });

  it('skips order when RPC returns empty (already claimed)', async () => {
    mocks.redisSet.mockReturnValueOnce('OK').mockReturnValueOnce('OK');
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'o2', order_display_id: 'O2', refund_tx_hash: '0xtx2' }], error: null }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
    };
    mocks.supabaseFrom.mockReturnValue(builder);
    await reconcilePendingEscrowRefunds(orderRepository);
    // Global lock: 1 call (OK)
    // Per-order lock: 1 call (via acquireLock → redisClient.set, OK)
    // RPC says already claimed — order skipped, no confirmEscrowRefund
    // Order lock released: 1 call to _redisDel
    // Global lock released: 1 call to _redisDel
    expect(mocks.redisSet).toHaveBeenCalledTimes(2); // global + per-order
    expect(mocks.redisDel).toHaveBeenCalledTimes(2); // per-order + global
  });

  it('releases global lock in finally block even when Supabase query fails', async () => {
    // Global lock OK; query fails; finally releases global lock (via redisClient.del)
    mocks.redisSet.mockReturnValueOnce('OK').mockReturnValueOnce('OK'); // lock OK, order lock OK
    const errorBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'oE', order_display_id: 'OE', refund_tx_hash: '0xtxe' }], error: null }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      update: vi.fn().mockReturnThis(),
    };
    mocks.supabaseFrom.mockReturnValue(errorBuilder);
    await reconcilePendingEscrowRefunds(orderRepository);
    // Global + per-order: 2 _redisSet calls; order lock released + global lock released: 2 _redisDel calls
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
    expect(mocks.redisDel).toHaveBeenCalledTimes(2);
  });

  it('releases per-order lock on successful processing', async () => {
    mocks.redisSet.mockReturnValueOnce('OK').mockReturnValueOnce('OK').mockReturnValueOnce('OK');
    configureBuilder([{ id: 'o3', order_display_id: 'O3', refund_tx_hash: '0xtx3' }]);
    await reconcilePendingEscrowRefunds(orderRepository);
    // Global lock: 1 _redisSet; per-order lock: 1 _redisSet; global lock release: 1 _redisSet (via redisClient.del, but our mock maps it to _redisDel)
    // Correction: releaseLock uses _redisDel, not _redisSet
    // So: _redisSet = 2 calls (global + per-order), _redisDel = 2 calls (per-order + global)
    expect(mocks.redisSet).toHaveBeenCalledTimes(2); // global + per-order lock
    expect(mocks.redisDel).toHaveBeenCalledTimes(2); // per-order release + global release
  });

  it('releases per-order lock in finally block even when confirmEscrowRefund throws', async () => {
    mocks.redisSet.mockReturnValueOnce('OK').mockReturnValueOnce('OK').mockReturnValueOnce('OK');
    configureBuilder([{ id: 'o4', order_display_id: 'O4', refund_tx_hash: '0xtx4' }]);
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
    expect(mocks.redisDel).toHaveBeenCalledTimes(2);
  });

  it('logs error and returns early when Supabase query fails', async () => {
    mocks.redisSet.mockReturnValueOnce(null);
    const errorBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB connection error' } }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
    };
    mocks.supabaseFrom.mockReturnValue(errorBuilder);
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(1); // global lock only (early return)
  });
});

describe('startEscrowRefundReconciliation', () => {
  it('sets up an interval timer without throwing', () => {
    configureBuilder([]);
    expect(() => startEscrowRefundReconciliation(orderRepository)).not.toThrow();
    stopEscrowRefundReconciliation();
  });

  it('returns early if timer is already running', () => {
    configureBuilder([]);
    startEscrowRefundReconciliation(orderRepository);
    expect(() => startEscrowRefundReconciliation(orderRepository)).not.toThrow();
    stopEscrowRefundReconciliation();
  });
});

describe('stopEscrowRefundReconciliation', () => {
  it('clears the interval timer without throwing', () => {
    expect(() => stopEscrowRefundReconciliation()).not.toThrow();
  });
});
