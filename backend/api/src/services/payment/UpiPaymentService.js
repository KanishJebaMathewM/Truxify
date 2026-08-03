import logger from '../../middleware/logger.js';

class UpiPaymentService {
  constructor() {
    this.gateway = (process.env.UPI_GATEWAY || '').toLowerCase();
    this.gatewayName = process.env.UPI_GATEWAY || 'none';
    this.razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
    this.razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
  }

  /**
   * Whether a real payment gateway is configured. A mock gateway must never
   * be used to fund escrow, because that lets an order reach
   * escrow_status = 'funded' without collecting any payment (issue #5998).
   */
  isGatewayConfigured() {
    return this.gateway === 'razorpay' &&
      Boolean(this.razorpayKeyId) &&
      Boolean(this.razorpayKeySecret);
  }

  /**
   * Create a payment collection order on the configured gateway.
   *
   * Never fabricates an order: a placeholder gateway_order_id would let
   * downstream flows treat an unpaid order as paid. Fails loudly instead.
   */
  async createPaymentOrder(orderId, amountPaisa, customerUpiId) {
    if (!this.isGatewayConfigured()) {
      throw new Error(
        'UPI payment gateway is not configured. Set UPI_GATEWAY=razorpay with RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
      );
    }
    // Real integration would create an order via the gateway SDK here and
    // return { gateway_order_id, amount, currency, status: 'created' }.
    // Refuse to fabricate an order until that SDK is wired up.
    throw new Error('Payment gateway SDK is not wired up; refusing to create a mock payment order.');
  }

  /**
   * Verify that a payment for the given order was actually captured by the
   * gateway. Returns { captured: true } ONLY for a confirmed capture.
   *
   * Fail closed: when no gateway is configured, or the capture cannot be
   * confirmed, this returns { captured: false } so callers must not proceed.
   */
  async verifyPaymentCaptured(orderId, customerUpiId) {
    if (!this.isGatewayConfigured()) {
      return { captured: false, reason: 'payment_gateway_not_configured' };
    }
    // Real integration would query the gateway for the order status /
    // payment capture confirmation. Never assume a payment was captured.
    return { captured: false, reason: 'payment_capture_unverified' };
  }

  /**
   * Mock payout to driver UPI ID
   */
  async processDriverPayout(driverUpiId, amountPaisa) {
    logger.info(`[UPI Payout] Initiating driver payout via ${this.gatewayName} to ${driverUpiId}, amount: ${amountPaisa} paisa`);
    // Simulate payout API delay
    await new Promise(resolve => setTimeout(resolve, 200));
    
    return {
      payout_id: `pout_${Math.random().toString(36).substring(2, 15)}`,
      status: 'processed',
      utr: Math.floor(100000000000 + Math.random() * 900000000000).toString(),
      processed_at: new Date().toISOString()
    };
  }
}

export default new UpiPaymentService();
