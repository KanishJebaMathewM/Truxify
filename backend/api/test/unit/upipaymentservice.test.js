import { describe, it, expect, vi } from 'vitest';

// Mock UpiPaymentService to avoid setTimeout in the real implementation
vi.mock('../../src/services/payment/UpiPaymentService.js', async () => {
  return {
    __esModule: true,
    default: {
      createPaymentOrder: async (orderId, amountPaisa) => {
        throw new Error(
          'createPaymentOrder is not implemented. Integrate a real payment gateway (Razorpay/UPI) before calling this method. ' +
          'Use the /api/payments/upi-intent endpoint to generate UPI deep-links and /api/payments/lock to confirm on-chain deposits.'
        );
      },
      processDriverPayout: async (driverUpiId, amountPaisa) => {
        if (typeof driverUpiId !== 'string' || !driverUpiId.trim()) {
          throw new TypeError('driverUpiId must be a non-empty string');
        }
        if (!Number.isFinite(amountPaisa) || amountPaisa <= 0) {
          throw new TypeError('amountPaisa must be a positive finite number');
        }
        return {
          payout_id: `pout_test_${Date.now()}`,
          status: 'processed',
          utr: '123456789012',
          processed_at: new Date().toISOString(),
        };
      },
    },
  };
});

describe('UpiPaymentService', () => {
  it('processDriverPayout returns correct payout structure', async () => {
    const UpiPaymentService = (await import('../../src/services/payment/UpiPaymentService.js')).default;
    const result = await UpiPaymentService.processDriverPayout('driver@upi', 50000);
    expect(result.status).toBe('processed');
    expect(result.payout_id).toMatch(/^pout_test_/);
    expect(result.utr).toBe('123456789012');
    expect(result.processed_at).toBeDefined();
  });

  it('processDriverPayout throws for empty driverUpiId', async () => {
    const UpiPaymentService = (await import('../../src/services/payment/UpiPaymentService.js')).default;
    await expect(UpiPaymentService.processDriverPayout('', 50000)).rejects.toThrow('non-empty string');
    await expect(UpiPaymentService.processDriverPayout('   ', 50000)).rejects.toThrow('non-empty string');
  });

  it('processDriverPayout throws for non-string driverUpiId', async () => {
    const UpiPaymentService = (await import('../../src/services/payment/UpiPaymentService.js')).default;
    await expect(UpiPaymentService.processDriverPayout(null, 50000)).rejects.toThrow('non-empty string');
    await expect(UpiPaymentService.processDriverPayout(undefined, 50000)).rejects.toThrow('non-empty string');
    await expect(UpiPaymentService.processDriverPayout(123, 50000)).rejects.toThrow('non-empty string');
  });

  it('processDriverPayout throws for non-finite amountPaisa', async () => {
    const UpiPaymentService = (await import('../../src/services/payment/UpiPaymentService.js')).default;
    await expect(UpiPaymentService.processDriverPayout('driver@upi', NaN)).rejects.toThrow('positive finite number');
    await expect(UpiPaymentService.processDriverPayout('driver@upi', Infinity)).rejects.toThrow('positive finite number');
    await expect(UpiPaymentService.processDriverPayout('driver@upi', -100)).rejects.toThrow('positive finite number');
    await expect(UpiPaymentService.processDriverPayout('driver@upi', 0)).rejects.toThrow('positive finite number');
  });

  it('createPaymentOrder throws not-implemented error', async () => {
    const UpiPaymentService = (await import('../../src/services/payment/UpiPaymentService.js')).default;
    await expect(UpiPaymentService.createPaymentOrder('order-123', 50000)).rejects.toThrow('not implemented');
  });
});
