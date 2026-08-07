import crypto from 'crypto';
import logger from '../../middleware/logger.js';

const DEFAULT_PAYOUT_GATEWAY = 'Razorpay (Mock)';
const MOCK_PAYOUT_DELAY_MS = 200;
const UTR_MIN = 100000000000;
const UTR_RANGE = 900000000000;

function generateUtr() {
  return (UTR_MIN + crypto.randomInt(0, UTR_RANGE)).toString();
}

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
      payout_id: `pout_${crypto.randomBytes(8).toString('hex')}`,
      status: 'processed',
      utr: generateUtr(),
      processed_at: new Date().toISOString()
    };
  }
}

export default new UpiPaymentService();
