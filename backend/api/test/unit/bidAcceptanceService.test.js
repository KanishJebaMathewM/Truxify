import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();
const mockFrom = vi.fn();
const mockOrderRepository = {
  findOrderByIdOrDisplayId: vi.fn(),
  updateOrderWithFilter: vi.fn(),
};

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
  LockAcquisitionError: class LockAcquisitionError extends Error {
    constructor() {
      super('Lock acquisition failed');
      this.name = 'LockAcquisitionError';
    }
  },
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: mockOrderRepository,
}));

describe('BidAcceptanceService', () => {
  let BidAcceptanceService;
  let DomainError;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const module = await import('../../src/services/order/bidAcceptanceService.js');
    BidAcceptanceService = module.BidAcceptanceService;
    DomainError = module.DomainError;
  });

  describe('acceptBid', () => {
    it('rejects bid when order is already funded', async () => {
      mockAcquireLock.mockResolvedValue('lock-value');
      mockOrderRepository.findOrderByIdOrDisplayId.mockResolvedValue({
        id: 'order-1',
        escrow_status: 'funded',
        status: 'in_transit',
      });

      const service = new BidAcceptanceService({
        orderRepository: mockOrderRepository,
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        notificationDispatcher: vi.fn(),
      });

      await expect(
        service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'cust-1' }),
      ).rejects.toThrow(DomainError);
    });

    it('throws when lock cannot be acquired', async () => {
      mockAcquireLock.mockResolvedValue(null);

      const service = new BidAcceptanceService({
        orderRepository: mockOrderRepository,
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        notificationDispatcher: vi.fn(),
      });

      await expect(
        service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'cust-1' }),
      ).rejects.toThrow(DomainError);
    });

    it('throws when order is in terminal state', async () => {
      mockAcquireLock.mockResolvedValue('lock-value');
      mockOrderRepository.findOrderByIdOrDisplayId.mockResolvedValue({
        id: 'order-1',
        escrow_status: 'pending',
        status: 'delivered',
      });

      const service = new BidAcceptanceService({
        orderRepository: mockOrderRepository,
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        notificationDispatcher: vi.fn(),
      });

      await expect(
        service.acceptBid({ orderId: 'order-1', bidId: 'bid-1', customerId: 'cust-1' }),
      ).rejects.toThrow(DomainError);
    });
  });
});
