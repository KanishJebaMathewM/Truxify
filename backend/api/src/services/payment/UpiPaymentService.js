import logger from '../../middleware/logger.js';

class UpiPaymentService {
  constructor() {
    this.gatewayName = process.env.UPI_GATEWAY || 'Razorpay (Mock)';
  }

  /**
   * Mock payment collection creation (e.g. Razorpay Order)
   */
  async createPaymentOrder(orderId, amountPaisa) {
    throw new Error(
      'createPaymentOrder is not implemented. Integrate a real payment gateway (Razorpay/UPI) before calling this method. ' +
      'Use the /api/payments/upi-intent endpoint to generate UPI deep-links and /api/payments/lock to confirm on-chain deposits.'
    );
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
