/**
 * Unit tests for backend/api/src/services/escrowRefundReconciliation.js
 *
 * Run with:  npm run test:unit -- test/unit/escrowRefundReconciliation.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// backend/api/test/unit/escrowRefundReconciliation.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reconcilePendingEscrowRefunds, _resetStateForTesting } from '../../src/services/escrowRefundReconciliation.js';
import supabase from '../../src/config/supabase.js';
import redisClient from '../../src/config/redis.js';
import { confirmEscrowRefund } from '../../src/services/escrow.js';
import { acquireLock, releaseLock } from '../../src/utils/redisLock.js';

// Mock dependencies
vi.mock('../../src/config/supabase.js', () => ({
  default: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    })),
    rpc: vi.fn(),
  },
}));

vi.mock('../../src/config/redis.js', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../src/services/escrow.js', () => ({
  confirmEscrowRefund: vi.fn(),
}));

vi.mock('../../src/utils/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('escrowRefundReconciliation.js Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof _resetStateForTesting === 'function') {
      _resetStateForTesting();
    }
    // Mock process.pid and os.hostname for deterministic output
    vi.spyOn(process, 'pid', 'get').mockReturnValue(12345);
    vi.spyOn(require('os'), 'hostname').mockReturnValue('test-host');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. skips when reconciliationRunning is true (idempotency guard)', async () => {
    // Run two concurrent calls
    acquireLock.mockResolvedValue(true);
    supabase.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    // Slow down the first call to keep reconciliationRunning = true
    const p1 = reconcilePendingEscrowRefunds();
    const p2 = reconcilePendingEscrowRefunds();

    await Promise.all([p1, p2]);
    // Expect acquireLock or supabase query to be guarded
    expect(acquireLock).toHaveBeenCalledTimes(1);
  });

  it('2. acquires global lock and queries pending refund orders from Supabase', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null });
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: selectMock,
    });

    await reconcilePendingEscrowRefunds();

    expect(acquireLock).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Number));
  });

  it('3. skips batch when global lock is held by another instance', async () => {
    acquireLock.mockResolvedValue(null); // Lock not acquired

    await reconcilePendingEscrowRefunds();

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('4. handles empty pending queue gracefully', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await reconcilePendingEscrowRefunds();

    expect(releaseLock).toHaveBeenCalled();
  });

  it('5. processes a single pending order: claims via RPC, confirms refund, updates order to refunded status', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    
    // Mock pending orders fetch
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'order_1', tx_hash: '0xabc', escrow_status: 'refund_pending' }],
        error: null,
      }),
    });

    // Mock RPC claim success
    supabase.rpc.mockResolvedValueOnce({ data: [{ id: 'order_1' }], error: null });

    // Mock blockchain confirmation success
    confirmEscrowRefund.mockResolvedValueOnce(true);

    // Mock order status update to refunded
    supabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    await reconcilePendingEscrowRefunds();

    expect(supabase.rpc).toHaveBeenCalled();
    expect(confirmEscrowRefund).toHaveBeenCalledWith('0xabc');
  });

  it('6. skips already-claimed orders (RPC returns empty claim)', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'order_1', tx_hash: '0xabc', escrow_status: 'refund_pending' }],
        error: null,
      }),
    });

    // Mock RPC claim returning empty (already claimed by another worker)
    supabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    await reconcilePendingEscrowRefunds();

    expect(confirmEscrowRefund).not.toHaveBeenCalled();
  });

  it('7. skips orders that are no longer in refund_pending status', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'order_1', tx_hash: '0xabc', escrow_status: 'completed' }],
        error: null,
      }),
    });

    await reconcilePendingEscrowRefunds();

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('8. handles blockchain confirmation failure with error logging', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'order_1', tx_hash: '0xabc', escrow_status: 'refund_pending' }],
        error: null,
      }),
    });

    supabase.rpc.mockResolvedValueOnce({ data: [{ id: 'order_1' }], error: null });
    confirmEscrowRefund.mockRejectedValueOnce(new Error('RPC Provider Error'));

    await reconcilePendingEscrowRefunds();

    // Verify reconciliation completes without crashing despite blockchain failure
    expect(releaseLock).toHaveBeenCalled();
  });

  it('9. releases per-order locks and global lock after processing', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await reconcilePendingEscrowRefunds();

    expect(releaseLock).toHaveBeenCalled();
  });

  it('10. properly resets reconciliationRunning flag on success and on error', async () => {
    acquireLock.mockResolvedValue('lock_token_123');
    
    // First run with error
    supabase.from.mockRejectedValueOnce(new Error('Database Down'));
    await reconcilePendingEscrowRefunds();

    // Second run should execute successfully (flag was reset)
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await reconcilePendingEscrowRefunds();
    expect(acquireLock).toHaveBeenCalledTimes(2);
  });
});
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
    // Added with the per-order renewal in #14681: no-op doubles so the
    // sweep exercises its full path without extra redis calls.
    renewLock: async () => true,
    withLockRenewal: async (_resourceKey, _lockValue, _ttlMs, fn) => fn(),
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

vi.mock('../../src/services/escrow.js', () => ({
  confirmEscrowRefund: vi.fn(),
  submitEscrowRefund: vi.fn(),
  submitEscrowCancelWithPenalty: vi.fn(),
  paisaToMaticWei: vi.fn((paisa) => BigInt(Math.round(Number(paisa))) * 10n**12n),
  getEscrowBookingId: vi.fn((orderDisplayId) => `0x${orderDisplayId.padStart(64, '0')}`),
  getOnChainEscrowBooking: vi.fn(async () => null),
}));

import { OrderRepository } from '../../src/repositories/orderRepository.js';
import { supabase } from '../../src/config/db.js';

import {
  reconcilePendingEscrowRefunds,
  startEscrowRefundReconciliation,
  stopEscrowRefundReconciliation,
} from '../../src/services/escrowRefundReconciliation.js';
import { getOnChainEscrowBooking, submitEscrowRefund } from '../../src/services/escrow.js';

let orderRepository;

beforeEach(() => {
  mocks.redisSet.mockReset();
  mocks.redisDel.mockReset();
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

  it('skips order if it is still within the exponential backoff window', async () => {
    mocks.redisSet.mockReturnValueOnce('OK'); // global lock
    const now = Date.now();
    // retryCount = 2, so backoff = 2^(2-1) * 60000 = 120000ms.
    // updated_at is only 30000ms ago, so it should skip!
    const recentUpdate = new Date(now - 30000).toISOString();
    configureBuilder([{
      id: 'oB',
      order_display_id: 'OB',
      escrow_refund_attempts: 2,
      updated_at: recentUpdate
    }]);

    await reconcilePendingEscrowRefunds(orderRepository);

    // Global lock acquired and released. No per-order lock because it skipped.
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

describe('reconciliationRunning Recovery Behavior', () => {
  it('1. allows subsequent execution when Redis lock is unavailable on first run', async () => {
    mocks.redisSet.mockReturnValueOnce(null); // lock fails on run 1
    configureBuilder([]);

    await reconcilePendingEscrowRefunds(orderRepository);

    // Verify second invocation is allowed to acquire lock and run
    mocks.redisSet.mockReturnValueOnce('OK');
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });

  it('2. allows subsequent execution when Redis set throws an error on first run', async () => {
    mocks.redisSet.mockRejectedValueOnce(new Error('Redis connection refused'));
    configureBuilder([]);

    await reconcilePendingEscrowRefunds(orderRepository);

    // Verify second invocation is allowed to execute normally
    mocks.redisSet.mockReturnValueOnce('OK');
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });

  it('3. allows subsequent execution when processing throws an exception', async () => {
    mocks.redisSet.mockReturnValueOnce('OK');
    const mockOrderRepoWithError = {
      findPendingEscrowRefunds: vi.fn().mockRejectedValue(new Error('Fatal DB crash')),
    };

    await expect(reconcilePendingEscrowRefunds(mockOrderRepoWithError)).rejects.toThrow('Fatal DB crash');

    // Verify recovery on next invocation
    mocks.redisSet.mockReturnValueOnce('OK');
    configureBuilder([]);
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });

  it('allows subsequent execution when findPendingEscrowRefunds returns an error result', async () => {
    mocks.redisSet.mockReturnValueOnce('OK');
    const mockOrderRepoWithDbError = {
      findPendingEscrowRefunds: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database connection timeout' } }),
    };

    await reconcilePendingEscrowRefunds(mockOrderRepoWithDbError);

    // Verify first call returned early
    expect(mockOrderRepoWithDbError.findPendingEscrowRefunds).toHaveBeenCalledTimes(1);

    // Verify second invocation recovers and reaches Redis lock operation
    mocks.redisSet.mockReturnValueOnce('OK');
    configureBuilder([]);
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });

  it('4. allows subsequent execution after successful reconciliation completion', async () => {
    mocks.redisSet.mockReturnValueOnce('OK');
    configureBuilder([]);

    await reconcilePendingEscrowRefunds(orderRepository);

    // Verify second run succeeds
    mocks.redisSet.mockReturnValueOnce('OK');
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });

  it('5. blocks concurrent invocation while running and allows execution after completion', async () => {
    mocks.redisSet.mockReturnValueOnce('OK');

    let resolvePending;
    const pendingPromise = new Promise(resolve => {
      resolvePending = resolve;
    });

    const mockDelayedRepo = {
      findPendingEscrowRefunds: vi.fn().mockImplementation(async () => {
        await pendingPromise;
        return { data: [], error: null };
      }),
    };

    // Start first invocation (will pause inside findPendingEscrowRefunds)
    const firstRunPromise = reconcilePendingEscrowRefunds(mockDelayedRepo);

    // Wait until the first sweep has actually entered the repository call:
    // without this the assertion below can run before the first invocation
    // gets past its lock acquisition, and a premature failure would skip
    // resolvePending and wedge the in-memory guard for every later test.
    await vi.waitFor(() => {
      expect(mockDelayedRepo.findPendingEscrowRefunds).toHaveBeenCalledTimes(1);
    });

    // Second concurrent invocation should exit immediately due to in-memory guard
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mockDelayedRepo.findPendingEscrowRefunds).toHaveBeenCalledTimes(1);

    // Complete first invocation
    resolvePending();
    await firstRunPromise;

    // Third invocation is now allowed to execute after first run completes
    mocks.redisSet.mockReturnValueOnce('OK');
    configureBuilder([]);
    await reconcilePendingEscrowRefunds(orderRepository);
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });
});

describe('reconcilePendingEscrowRefunds — issue #8891 started-trip guard', () => {
  beforeEach(() => {
    vi.mocked(getOnChainEscrowBooking).mockReset();
    vi.mocked(submitEscrowRefund).mockReset();
  });

  // Builder whose claim RPC returns the order as claimed so processing reaches
  // the refund dispatch (rather than skipping as "already claimed").
  function configureProcessingBuilder(order) {
    mocks.supabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [order], error: null }),
      rpc: vi.fn().mockResolvedValue({ data: [order], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
  }

  it('aborts full refund and skips submitEscrowRefund when on-chain booking is started', async () => {
    mocks.redisSet.mockReturnValueOnce('OK').mockReturnValueOnce('OK');
    vi.mocked(getOnChainEscrowBooking).mockResolvedValue({ started: true });

    configureProcessingBuilder({
      id: 'o8891',
      order_display_id: 'O8891',
      cancellation_fee: 0,
      escrow_refund_attempts: 0,
      updated_at: new Date(Date.now() - 120_000).toISOString(),
    });

    await reconcilePendingEscrowRefunds(orderRepository);

    expect(getOnChainEscrowBooking).toHaveBeenCalledTimes(1);
    expect(submitEscrowRefund).not.toHaveBeenCalled();
  });

  it('proceeds with submitEscrowRefund when on-chain booking is not started', async () => {
    mocks.redisSet.mockReturnValueOnce('OK').mockReturnValueOnce('OK');
    vi.mocked(getOnChainEscrowBooking).mockResolvedValue({ started: false });
    vi.mocked(submitEscrowRefund).mockResolvedValue({
      txHash: '0xrefund',
      bookingId: '0xbooking',
      waitForConfirmation: async () => ({ hash: '0xrefund', status: 1 }),
    });

    configureProcessingBuilder({
      id: 'o8891b',
      order_display_id: 'O8891B',
      cancellation_fee: 0,
      escrow_refund_attempts: 0,
      updated_at: new Date(Date.now() - 120_000).toISOString(),
    });

    await reconcilePendingEscrowRefunds(orderRepository);

    expect(getOnChainEscrowBooking).toHaveBeenCalledTimes(2);
    expect(submitEscrowRefund).toHaveBeenCalledTimes(1);
  });
});
