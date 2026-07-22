import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderLifecycleService } from '../../../src/services/order/orderLifecycleService.js';
import { DomainError } from '../../../src/services/order/domainError.js';
import * as redisLock from '../../../src/lib/redisLock.js';

vi.mock('../../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn()
}));

describe('OrderLifecycleService - verifyDeliveryFn', () => {
  let service;
  let mockOrderRepo;
  let mockTimelineService;
  let mockBidService;
  let mockDeliveryVerification;

  beforeEach(() => {
    mockOrderRepo = {};
    mockTimelineService = {};
    mockBidService = {};
    mockDeliveryVerification = {
      verifyDelivery: vi.fn()
    };

    service = new OrderLifecycleService({
      orderRepository: mockOrderRepo,
      orderTimelineService: mockTimelineService,
      bidAcceptanceService: mockBidService,
      deliveryVerificationService: mockDeliveryVerification
    });

    // Replace the instantiated one with our mock
    service.deliveryVerification = mockDeliveryVerification;
    
    vi.clearAllMocks();
  });

  it('should acquire escrow lock before verifying delivery', async () => {
    const lockValue = 'mock-lock-val';
    vi.mocked(redisLock.acquireLock).mockResolvedValue(lockValue);
    mockDeliveryVerification.verifyDelivery.mockResolvedValue({ success: true });

    const orderId = 'order-123';
    const driverId = 'driver-456';
    const otp = '123456';

    const result = await service.verifyDeliveryFn(orderId, driverId, otp);

    expect(redisLock.acquireLock).toHaveBeenCalledWith(`escrow_lock:${orderId}`, 30000);
    expect(mockDeliveryVerification.verifyDelivery).toHaveBeenCalledWith({ orderId, driverId, otp });
    expect(redisLock.releaseLock).toHaveBeenCalledWith(`escrow_lock:${orderId}`, lockValue);
    expect(result).toEqual({ success: true });
  });

  it('should throw 409 DomainError if lock cannot be acquired', async () => {
    vi.mocked(redisLock.acquireLock).mockResolvedValue(null);

    const orderId = 'order-123';
    
    await expect(service.verifyDeliveryFn(orderId, 'driver-456', '123456'))
      .rejects
      .toThrow(DomainError);
      
    try {
      await service.verifyDeliveryFn(orderId, 'driver-456', '123456');
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.payload.error).toMatch(/currently being processed/);
    }
    
    // Verify it did not proceed to verifyDelivery
    expect(mockDeliveryVerification.verifyDelivery).not.toHaveBeenCalled();
    expect(redisLock.releaseLock).not.toHaveBeenCalled();
  });

  it('should release lock even if verifyDelivery throws an error', async () => {
    const lockValue = 'mock-lock-val';
    vi.mocked(redisLock.acquireLock).mockResolvedValue(lockValue);
    mockDeliveryVerification.verifyDelivery.mockRejectedValue(new Error('Internal verification failed'));

    const orderId = 'order-123';

    await expect(service.verifyDeliveryFn(orderId, 'driver-456', '123456'))
      .rejects
      .toThrow('Internal verification failed');

    expect(redisLock.releaseLock).toHaveBeenCalledWith(`escrow_lock:${orderId}`, lockValue);
  });
});
