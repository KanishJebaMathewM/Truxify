import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import UpiPaymentService from '../../src/services/payment/UpiPaymentService.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('UpiPaymentService', () => {
  describe('processDriverPayout', () => {
    it('should generate secure payout_id and utr using crypto modules', async () => {
      const amount = 500;
      const upiId = 'driver@upi';
      
      const randomUUIDSpy = vi.spyOn(crypto, 'randomUUID');
      const randomIntSpy = vi.spyOn(crypto, 'randomInt');
      
      const result = await UpiPaymentService.processDriverPayout(upiId, amount);
      
      expect(result).toBeDefined();
      expect(result.status).toBe('processed');
      expect(result.processed_at).toBeDefined();
      
      // Check payout_id format (pout_ + UUIDv4)
      // UUIDv4 format: 8-4-4-4-12 hex digits with version 4 and variant 8, 9, a, or b
      expect(result.payout_id).toMatch(/^pout_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      
      // Check utr format (12-digit number)
      expect(result.utr).toMatch(/^\d{12}$/);
      
      // Verify crypto methods are invoked for identifier generation
      expect(randomUUIDSpy).toHaveBeenCalled();
      expect(randomIntSpy).toHaveBeenCalledWith(100000000000, 1000000000000);
      
      randomUUIDSpy.mockRestore();
      randomIntSpy.mockRestore();
    });
  });

  describe('createPaymentOrder', () => {
    it('should throw not implemented error', async () => {
      await expect(UpiPaymentService.createPaymentOrder('order_1', 100))
        .rejects.toThrow(/createPaymentOrder is not implemented/);
    });
  });
});
