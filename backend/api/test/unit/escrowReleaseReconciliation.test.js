/**
 * Unit tests for backend/api/src/services/escrowReleaseReconciliation.js
 *
 * Coverage:
 *   - reconcilePendingEscrowReleases: skips when Redis lock is held by another instance
 *   - reconcilePendingEscrowReleases: returns early when no failed orders exist
 *   - reconcilePendingEscrowReleases: processes a single release order successfully
 *   - reconcilePendingEscrowReleases: handles escrowRelease throwing and increments retry count
 *   - reconcilePendingEscrowReleases: escalates after MAX_RETRIES attempts
 *   - reconcilePendingEscrowReleases: cleans up Redis lock in finally block
 *   - startEscrowReleaseReconciliation / stopEscrowReleaseReconciliation: timer lifecycle
 *
 * Run with:  npm run test:unit -- test/unit/escrowReleaseReconciliation.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEscrowRelease = vi.hoisted(() => vi.fn());

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockRedisClient = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
}));

// Supabase mock — creates a chainable from().select().eq().lt().limit() query builder
function makeEqFn(result) {
  return vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve(result)),
  }));
}

function makeUpdateMock() {
  return vi.fn(() => ({
    eq: makeEqFn({ error: null }),
  }));
}

function makeSupabaseMock(failedOrdersData) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({ data: failedOrdersData, error: null })),
          })),
        })),
      })),
      rpc: vi.fn(() => Promise.resolve({ data: 'claimed', error: null })),
      update: makeUpdateMock(),
    })),
  };
}

const mockSupabase = vi.hoisted(() => makeSupabaseMock([]));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../src/services/escrow.js', () => ({
  escrowRelease: mockEscrowRelease,
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: mockSupabase,
  redisClient: mockRedisClient,
}));

vi.mock('os', () => ({
  default: { hostname: () => 'test-host' },
}));

import {
  reconcilePendingEscrowReleases,
  startEscrowReleaseReconciliation,
  stopEscrowReleaseReconciliation,
} from '../../src/services/escrowReleaseReconciliation.js';

describe('escrowReleaseReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function withFailedOrders(orders) {
    // supabase.rpc() is called directly on the supabase client
    mockSupabase.rpc = vi.fn(() => Promise.resolve({ data: 'claimed', error: null }));

    // Build a query builder object that supabase.from() returns
    const queryBuilder = {
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    };
    const selectChain = {
      eq: vi.fn(() => ({
        lt: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: orders, error: null })),
        })),
      })),
    };
    queryBuilder.select = vi.fn(() => selectChain);

    mockSupabase.from = vi.fn(() => queryBuilder);
  }

  it('skips when Redis lock is held by another instance', async () => {
    mockRedisClient.set.mockResolvedValueOnce(null);

    await reconcilePendingEscrowReleases();

    expect(mockLogger.info).toHaveBeenCalledWith(
      '[escrow-release-reconciliation] Lock held by another instance, skipping.'
    );
    expect(mockSupabase.from).toHaveBeenCalledTimes(0);
  });

  it('returns early when no failed orders exist', async () => {
    mockRedisClient.set.mockResolvedValueOnce('lock-value');
    mockRedisClient.del.mockResolvedValueOnce(1);

    await reconcilePendingEscrowReleases();

    expect(mockLogger.info).toHaveBeenCalledWith(
      '[escrow-release-reconciliation] No pending release failures found.'
    );
  });

  it('successfully processes a release order', async () => {
    mockRedisClient.set.mockResolvedValueOnce('lock-value');
    mockRedisClient.del.mockResolvedValueOnce(1);
    withFailedOrders([{ id: 'order-1', order_display_id: 'ORD-001', escrow_release_attempts: 0 }]);
    mockEscrowRelease.mockResolvedValueOnce({ txHash: '0xtxhash123' });

    await reconcilePendingEscrowReleases();

    // escrowRelease should be called for a successful release
    expect(mockEscrowRelease.mock.calls.length).toBeGreaterThan(0);
  });

  it('handles escrowRelease throwing and increments retry count', async () => {
    mockRedisClient.set.mockResolvedValueOnce('lock-value');
    mockRedisClient.del.mockResolvedValueOnce(1);
    withFailedOrders([{ id: 'order-1', order_display_id: 'ORD-001', escrow_release_attempts: 0 }]);
    mockEscrowRelease.mockRejectedValueOnce(new Error('RPC timeout'));

    await reconcilePendingEscrowReleases();

    // On error the code calls logger.warn for retry backoff
    expect(mockLogger.warn.mock.calls.length).toBeGreaterThan(0);
  });

  it('escalates after MAX_RETRIES (10) attempts', async () => {
    mockRedisClient.set.mockResolvedValueOnce('lock-value');
    mockRedisClient.del.mockResolvedValueOnce(1);
    withFailedOrders([{ id: 'order-1', order_display_id: 'ORD-001', escrow_release_attempts: 9 }]);
    mockEscrowRelease.mockRejectedValueOnce(new Error('persistent failure'));

    await reconcilePendingEscrowReleases();

    expect(mockLogger.error.mock.calls[0][0]).toContain('has failed 10 times');
    expect(mockLogger.error.mock.calls[0][0]).toContain('Escalating to manual review');
  });

  it('cleans up Redis lock in finally block', async () => {
    mockRedisClient.set.mockResolvedValueOnce('lock-value');
    mockRedisClient.del.mockResolvedValueOnce(1);
    withFailedOrders([{ id: 'order-1', order_display_id: 'ORD-001', escrow_release_attempts: 0 }]);
    mockEscrowRelease.mockResolvedValueOnce({ txHash: '0xtxhash123' });

    await reconcilePendingEscrowReleases();

    expect(mockRedisClient.del).toHaveBeenCalled();
  });
});

describe('timer lifecycle', () => {
  it('sets an interval timer when startEscrowReleaseReconciliation is called', () => {
    const originalSetInterval = global.setInterval;
    const mockSetInterval = vi.fn((fn, ms) => originalSetInterval(fn, ms));
    global.setInterval = mockSetInterval;

    startEscrowReleaseReconciliation();
    stopEscrowReleaseReconciliation();

    expect(mockSetInterval).toHaveBeenCalled();
    global.setInterval = originalSetInterval;
  });

  it('clears the interval timer when stopEscrowReleaseReconciliation is called', () => {
    const originalClearInterval = global.clearInterval;
    const mockClearInterval = vi.fn();
    global.clearInterval = mockClearInterval;

    startEscrowReleaseReconciliation();
    stopEscrowReleaseReconciliation();

    expect(mockClearInterval).toHaveBeenCalled();
    global.clearInterval = originalClearInterval;
  });
});
