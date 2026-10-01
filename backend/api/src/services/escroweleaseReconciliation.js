import logger from '../middleware/logger.js';
import { orderRepository } from '../repositories/orderRepository.js';

export class EscrowReleaseReconciliationService {
  async reconcileOrder(orderId) {
    const fresh = await orderRepository.findById(orderId);
    if (!fresh) {
      logger.warn({ orderId }, '[escrow-release-reconciliation] Order not found');
      return;
    }

    // Preserve cancellation handling
    if (fresh.status === 'cancelled') {
      logger.info(
        { orderId: fresh.order_display_id, status: fresh.status },
        '[escrow-release-reconciliation] Order is cancelled, skipping.'
      );
      return;
    }

    // Allow delivered orders to proceed unless settlement is already finalized
    if (fresh.status === 'delivered' && fresh.settlement_finalized === true) {
      logger.info(
        { orderId: fresh.order_display_id, status: fresh.status },
        '[escrow-release-reconciliation] Order is delivered and already settlement-finalized, skipping.'
      );
      return;
    }

    logger.info(
      { orderId: fresh.order_display_id, status: fresh.status },
      '[escrow-release-reconciliation] Proceeding with escrow settlement reconciliation.'
    );

    // Execute idempotent settlement finalization
    await this.processEscrowFinalization(fresh);
  }

  async processEscrowFinalization(order) {
    if (!order.settlement_finalized) {
      await orderRepository.finalizeSettlement(order.id);
      logger.info(
        { orderId: order.order_display_id },
        '[escrow-release-reconciliation] Successfully completed database finalization for delivered order.'
      );
    }
  }
}

export default new EscrowReleaseReconciliationService();
