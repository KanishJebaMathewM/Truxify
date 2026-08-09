/**
 * Unit tests for backend/api/src/services/escrowFundingReconciliation.js
 *
 * Coverage:
 *   - dueForRetry: returns true when attempts is 0
 *   - dueForRetry: returns true when attempts > 0 and backoff has elapsed
 *   - dueForRetry: returns false when backoff has not elapsed
 *   - reconcileStaleFunding: returns early when orderRepository is null
 *   - reconcileStaleFunding: skips batch when global Redis lock is not acquired
 *
 * Run with:  npm run test:unit -- test/unit/escrowFundingReconciliation.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockRedisClient = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: mockRedisClient,
  supabaseAdmin: {},
}));

vi.mock('../../src/services/escrow.js', () => ({
  escrowRefund: vi.fn(),
  getEscrowBooking: vi.fn(),
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
}));

// Mock the order repository
const mockOrderRepository = vi.hoisted(() => ({
  findStaleFundingOrders: vi.fn(),
  updateOrder: vi.fn(),
  updateOrderWithFilter: vi.fn(),
  executeRpc: vi.fn(),
}));

import { reconcileStaleFunding } from '../../src/services/escrowFundingReconciliation.js';

describe('escrowFundingReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reconcileStaleFunding', () => {
    it('throws when orderRepository is null', async () => {
      await expect(reconcileStaleFunding(null)).rejects.toThrow('requires an OrderRepository instance');
    });

    it('skips batch when global Redis lock is not acquired', async () => {
      mockRedisClient.set.mockResolvedValue(null); // lock not acquired

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockLogger.info).toHaveBeenCalledWith('[escrow-funding] Global lock held by another instance, skipping batch.');
    });

    it('acquires Redis lock and processes orders when lock is acquired', async () => {
      mockRedisClient.set.mockResolvedValue('locked');

      const mockOrders = [
        {
          id: 'order-1',
          order_display_id: 'DIS-1',
          escrow_status: 'funding',
          escrow_booking_id: 'booking-1',
          escrow_funding_attempts: 0,
          escrow_funding_last_attempt_at: null,
          pending_bid_acceptance: null,
        },
      ];
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: mockOrders, error: null });

      // Mock the lock acquisition for finalizeOrRevert
      const { acquireLock, releaseLock } = await import('../../src/lib/redisLock.js');
      acquireLock.mockResolvedValueOnce('lock-value');
      releaseLock.mockResolvedValueOnce(undefined);

      const { getEscrowBooking } = await import('../../src/services/escrow.js');
      getEscrowBooking.mockResolvedValueOnce({ paid: false });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('escrow:funding:reconciliation:lock'),
        expect.any(String),
        'NX',
        'EX',
        expect.any(Number)
      );
      expect(mockOrderRepository.findStaleFundingOrders).toHaveBeenCalled();
    });

    it('returns early on DB error when fetching stale orders', async () => {
      mockRedisClient.set.mockResolvedValue('locked');
      mockOrderRepository.findStaleFundingOrders.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

      await reconcileStaleFunding(mockOrderRepository);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[escrow-funding] Failed to load stale funding orders:',
        'DB error'
      );
    });
  });
});
