import { supabase, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { confirmEscrowRefund } from './escrow.js';
import os from 'os';

const DEFAULT_INTERVAL_MS = 60_000;
const LOCK_KEY = 'escrow:reconciliation:lock';
const LOCK_TTL_SECONDS = 120;
const LEASE_EXTENSION_INTERVAL_MS = (LOCK_TTL_SECONDS * 1000) / 2;
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcilePendingEscrowRefunds() {
  let lockAcquired = false;
  let leaseExtender = null;

  if (redisClient) {
    try {
      const acquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      if (!acquired) {
        logger.info('[escrow-reconciliation] Lock held by another instance, skipping.');
        return;
      }
      lockAcquired = true;
      leaseExtender = setInterval(async () => {
        try {
          await redisClient.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        } catch (err) {
          logger.warn('[escrow-reconciliation] Failed to extend lock lease:', err.message);
        }
      }, LEASE_EXTENSION_INTERVAL_MS);
    } catch (err) {
      logger.error('[escrow-reconciliation] Failed to acquire Redis lock:', err.message);
    }
  }

  if (!lockAcquired) {
    if (reconciliationRunning) return;
    reconciliationRunning = true;
  }

  try {
    const instanceId = process.env.HOSTNAME || os.hostname();
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
        const { data: claimed, error: claimError } = await supabase
          .rpc('claim_refund_reconciliation', {
            p_order_id: order.id,
            p_instance_id: instanceId,
          });

        if ((!claimed || claimed.length === 0) && !claimError) {
          logger.info(`[escrow-reconciliation] Order ${order.order_display_id} already claimed by another instance, skipping.`);
          continue;
        }

        if (claimError) {
          const { data: existing } = await supabase
            .from('orders')
            .select('escrow_status, reconciled_by')
            .eq('id', order.id)
            .maybeSingle();
          if (existing && (existing.escrow_status !== 'refund_pending' || existing.reconciled_by)) {
            logger.info(`[escrow-reconciliation] Order ${order.order_display_id} already processed, skipping.`);
            continue;
          }
        }

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
    if (leaseExtender) {
      clearInterval(leaseExtender);
    }
    if (lockAcquired && redisClient) {
      await redisClient.del(LOCK_KEY).catch(() => {});
    }
    if (!lockAcquired) {
      reconciliationRunning = false;
    }
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
