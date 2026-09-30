import logger from '../middleware/logger.js';

// Internal constants (unexported to prevent leakage in public API)
const PAISA_WEI_SCALE = 1000000000000000000n;
const ESCROW_AMOUNT_TOLERANCE_WEI = 1000n;

export class EscrowService {
  /**
   * Validates and processes escrow deposit matching payment amounts.
   */
  async verifyDeposit(orderId, expectedAmountWei, actualAmountWei) {
    try {
      const expected = BigInt(expectedAmountWei);
      const actual = BigInt(actualAmountWei);
      
      const difference = actual > expected ? actual - expected : expected - actual;

      if (difference > ESCROW_AMOUNT_TOLERANCE_WEI) {
        logger.warn(
          { orderId, expected: expected.toString(), actual: actual.toString() },
          '[escrow-service] Deposit amount verification failed due to tolerance exceeded'
        );
        return false;
      }

      logger.info({ orderId }, '[escrow-service] Deposit verified successfully');
      return true;
    } catch (err) {
      logger.error({ err, orderId }, '[escrow-service] Error verifying escrow deposit');
      throw err;
    }
  }

  /**
   * Scales paisa/tokens to wei format using internal scale factor.
   */
  scaleToWei(amount) {
    return BigInt(amount) * PAISA_WEI_SCALE;
  }
}

export default new EscrowService();
