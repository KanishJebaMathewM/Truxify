import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderLifecycleService } from '../../../src/services/order/orderLifecycleService.js';
import { DomainError } from '../../../src/services/order/domainError.js';
import * as lockFallback from '../../../src/lib/lockFallback.js';

vi.mock('../../../src/lib/lockFallback.js', () => ({
  acquireLockOrFallback: vi.fn()
}));

describe('OrderLifecycleService - verifyDeliveryFn', () => {
  it('rejects the universal development OTP before verification', async () => {
    await expect(service.verifyDeliveryFn('order-123', 'driver-456', '123456')).rejects.toThrow('Invalid delivery OTP');
    expect(mockDeliveryVerification.verifyDelivery).not.toHaveBeenCalled();
  });
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
    const release = vi.fn();
    vi.mocked(lockFallback.acquireLockOrFallback).mockResolvedValue({ ok: true, release });
    mockDeliveryVerification.verifyDelivery.mockResolvedValue({ success: true });

    const orderId = 'order-123';
    const driverId = 'driver-456';
    const otp = '654321';
    const mockUserClient = { rpc: vi.fn() };

    const result = await service.verifyDeliveryFn(orderId, driverId, otp, mockUserClient);

    expect(lockFallback.acquireLockOrFallback).toHaveBeenCalledWith(`escrow_lock:${orderId}`, 120000);
    expect(mockDeliveryVerification.verifyDelivery).toHaveBeenCalledWith({ orderId, driverId, otp }, mockUserClient);
    expect(release).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('should throw 409 DomainError if lock cannot be acquired', async () => {
    vi.mocked(lockFallback.acquireLockOrFallback).mockResolvedValue({ ok: false, release: async () => {} });

    const orderId = 'order-123';

    await expect(service.verifyDeliveryFn(orderId, 'driver-456', '654321'))
      .rejects
      .toThrow(DomainError);

    try {
      await service.verifyDeliveryFn(orderId, 'driver-456', '654321');
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.payload.error).toMatch(/currently being processed/);
    }

    // Verify it did not proceed to verifyDelivery
    expect(mockDeliveryVerification.verifyDelivery).not.toHaveBeenCalled();
  });

  it('should release lock even if verifyDelivery throws an error', async () => {
    const release = vi.fn();
    vi.mocked(lockFallback.acquireLockOrFallback).mockResolvedValue({ ok: true, release });
    mockDeliveryVerification.verifyDelivery.mockRejectedValue(new Error('Internal verification failed'));

    const orderId = 'order-123';

    await expect(service.verifyDeliveryFn(orderId, 'driver-456', '654321'))
      .rejects
      .toThrow('Internal verification failed');

    expect(release).toHaveBeenCalled();
  });
});
