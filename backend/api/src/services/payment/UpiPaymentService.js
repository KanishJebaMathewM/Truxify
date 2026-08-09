import crypto from 'crypto';
import logger from '../../middleware/logger.js';

const DEFAULT_PAYOUT_GATEWAY = 'Razorpay (Mock)';
const MOCK_PAYOUT_DELAY_MS = 200;

class UpiPaymentService {
  constructor() {
    this.gatewayName = process.env.UPI_GATEWAY || DEFAULT_PAYOUT_GATEWAY;
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
    await new Promise(resolve => setTimeout(resolve, MOCK_PAYOUT_DELAY_MS));

    return {
      payout_id: `pout_${crypto.randomUUID()}`,
      status: 'processed',
      utr: crypto.randomInt(100000000000, 1000000000000).toString(),
      processed_at: new Date().toISOString()
    };
  }
}

export default new UpiPaymentService();
