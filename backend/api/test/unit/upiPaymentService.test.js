import { describe, it, expect, vi, afterEach } from 'vitest';

describe('UpiPaymentService (fail-closed)', () => {
  afterEach(() => {
    delete process.env.UPI_GATEWAY;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    vi.resetModules();
  });

  it('reports gateway not configured when UPI_GATEWAY is unset', async () => {
    delete process.env.UPI_GATEWAY;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    vi.resetModules();

    const { default: svc } = await import('../../src/services/payment/UpiPaymentService.js');

    expect(svc.isGatewayConfigured()).toBe(false);

    const verification = await svc.verifyPaymentCaptured('order-1', 'customer@upi');
    expect(verification.captured).toBe(false);
    expect(verification.reason).toBe('payment_gateway_not_configured');

    await expect(svc.createPaymentOrder('order-1', 5000)).rejects.toThrow('not configured');
  });

  it('reports not configured for razorpay without credentials', async () => {
    process.env.UPI_GATEWAY = 'razorpay';
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    vi.resetModules();

    const { default: svc } = await import('../../src/services/payment/UpiPaymentService.js');

    expect(svc.isGatewayConfigured()).toBe(false);
  });

  it('never fabricates an order or a capture even when a gateway is configured', async () => {
    process.env.UPI_GATEWAY = 'razorpay';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key_id';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_key_secret';
    vi.resetModules();

    const { default: svc } = await import('../../src/services/payment/UpiPaymentService.js');

    expect(svc.isGatewayConfigured()).toBe(true);

    const verification = await svc.verifyPaymentCaptured('order-1', 'customer@upi');
    expect(verification.captured).toBe(false);
    expect(verification.reason).toBe('payment_capture_unverified');

    await expect(svc.createPaymentOrder('order-1', 5000)).rejects.toThrow(
      'refusing to create a mock payment order'
    );
  });
});
