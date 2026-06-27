import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { confirmEscrowRefund } from './escrow.js';

const DEFAULT_INTERVAL_MS = 60_000;
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcilePendingEscrowRefunds() {
  if (reconciliationRunning) return;
  reconciliationRunning = true;

  try {
    const { data: pendingOrders, error } = await supabase
      .from('orders')
      .select('id, order_display_id, refund_tx_hash')
      .eq('escrow_status', 'refund_pending')
      .not('refund_tx_hash', 'is', null)
      .limit(50);

    if (error) {
      logger.error('[escrow-reconciliation] Failed to load pending refunds:', error.message);
      return;
    }

    for (const order of pendingOrders ?? []) {
      try {
        const receipt = await confirmEscrowRefund(order.refund_tx_hash);
        const refundedAt = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            escrow_status: 'refunded',
            refund_tx_hash: receipt.hash ?? order.refund_tx_hash,
            escrow_refunded_at: refundedAt,
            escrow_refund_error: null,
            updated_at: refundedAt,
          })
          .eq('id', order.id)
          .eq('escrow_status', 'refund_pending');

        if (updateError) {
          logger.error(
            `[escrow-reconciliation] Failed to finalize refund for ${order.order_display_id}:`,
            updateError.message
          );
        }
      } catch (err) {
        logger.warn(
          `[escrow-reconciliation] Refund for ${order.order_display_id} is not confirmed yet:`,
          err.message
        );
      }
    }
  } finally {
    reconciliationRunning = false;
  }
}

export function startEscrowRefundReconciliation() {
  if (reconciliationTimer) return;

  const configuredInterval = Number(process.env.ESCROW_RECONCILIATION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  reconciliationTimer = setInterval(() => {
    void reconcilePendingEscrowRefunds();
  }, intervalMs);
  reconciliationTimer.unref?.();
}

export function stopEscrowRefundReconciliation() {
  if (!reconciliationTimer) return;
  clearInterval(reconciliationTimer);
  reconciliationTimer = null;
}
