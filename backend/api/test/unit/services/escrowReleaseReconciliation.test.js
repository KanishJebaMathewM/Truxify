import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcilePendingEscrowReleases } from '../../../src/services/escrowReleaseReconciliation.js';

vi.mock('../../../src/config/db.js', () => ({
  supabaseAdmin: {},
}));

vi.mock('../../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  renewLock: vi.fn(),
  withLockRenewal: vi.fn(async (_key, _value, _ttl, asyncFn) => asyncFn()),
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
  getOnChainEscrowBooking: vi.fn(),
  getEscrowBookingId: vi.fn((orderDisplayId) => `booking-${orderDisplayId}`),
  resolveExpectedDepositAmount: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { acquireLock, releaseLock } from '../../../src/lib/redisLock.js';
import { getOnChainEscrowBooking } from '../../../src/services/escrow.js';

describe('EscrowReleaseReconciliationService - Delivered Orders Fix (#15278)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireLock.mockResolvedValue('lock-uuid');
    releaseLock.mockResolvedValue(true);
  });

  function pendingOrder(overrides = {}) {
    return {
      id: 'ord-1',
      order_display_id: 'TRX-100',
      ...overrides,
    };
  }

  function freshOrder(overrides = {}) {
    return {
      id: 'ord-1',
      order_display_id: 'TRX-100',
      status: 'delivered',
      escrow_status: 'funded',
      release_tx_hash: null,
      ...overrides,
    };
  }

  function repoFor(pending, fresh) {
    return {
      findPendingEscrowReleases: vi.fn().mockResolvedValue({ data: pending, error: null }),
      findOrderById: vi.fn().mockResolvedValue({ data: fresh, error: null }),
      updateOrder: vi.fn().mockResolvedValue({ error: null }),
      executeRpc: vi.fn().mockResolvedValue({ error: null }),
    };
  }

  it('should skip cancelled orders', async () => {
    const repo = repoFor(
      [pendingOrder()],
      freshOrder({ status: 'cancelled' })
    );

    await reconcilePendingEscrowReleases(repo);

    expect(repo.updateOrder).not.toHaveBeenCalled();
    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it('should skip delivered orders that are already settlement-finalized', async () => {
    const repo = repoFor(
      [pendingOrder({ id: 'ord-2', order_display_id: 'TRX-101' })],
      freshOrder({
        id: 'ord-2',
        order_display_id: 'TRX-101',
        status: 'payment_released',
      })
    );

    await reconcilePendingEscrowReleases(repo);

    expect(repo.updateOrder).not.toHaveBeenCalled();
    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it('should finalize funded orders whose release already landed on-chain', async () => {
    getOnChainEscrowBooking.mockResolvedValue({ paid: true });
    const repo = repoFor(
      [pendingOrder({ id: 'ord-3', order_display_id: 'TRX-102' })],
      freshOrder({
        id: 'ord-3',
        order_display_id: 'TRX-102',
        status: 'in_transit',
        escrow_status: 'funded',
        release_tx_hash: '0xabc',
      })
    );

    await reconcilePendingEscrowReleases(repo);

    expect(repo.updateOrder).toHaveBeenCalledWith(
      'ord-3',
      expect.objectContaining({ escrow_status: 'released' })
    );
    expect(repo.executeRpc).toHaveBeenCalled();
    const rpcCall = repo.executeRpc.mock.calls[0];
    expect(rpcCall[0]).toBe('complete_trip_tx');
    expect(rpcCall[1]).toEqual(expect.objectContaining({ p_order_id: 'ord-3' }));
  });
});
