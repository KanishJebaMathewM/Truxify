import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { confirmEscrowRefund, submitEscrowRefund } from './escrow.js';
import { acquireLock, releaseLock } from '../lib/redisLock.js';
import os from 'os';

const RECONCILIATION_EVENTS = {
  STARTED: 'reconciliation:started',
  COMPLETED: 'reconciliation:completed',
  FAILED: 'reconciliation:failed',
  CLAIMED: 'reconciliation:claimed',
  SKIPPED: 'reconciliation:skipped',
};

function logReconciliationEvent(event, details = {}) {
  logger.info({ event, ...details }, `[escrow-reconciliation] ${event}`);
}

function createReconciliationSummary(results) {
  return {
    total: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    skipped: results.filter(r => r.skipped).length,
    timestamp: new Date().toISOString(),
  };
}

const DEFAULT_INTERVAL_MS = 60_000;
const LOCK_KEY = 'escrow:reconciliation:lock';
const LOCK_TTL_SECONDS = 120;
const LEASE_EXTENSION_INTERVAL_MS = (LOCK_TTL_SECONDS * 1000) / 2;
const MAX_RETRIES = 10;
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcilePendingEscrowRefunds(orderRepository) {
  if (!orderRepository) {
    throw new Error('reconcilePendingEscrowRefunds requires an OrderRepository instance');
  }
  if (reconciliationRunning) return;
  reconciliationRunning = true;

  try {
    let globalLockAcquired = false;
    if (redisClient) {
      try {
        globalLockAcquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      } catch (err) {
        logger.error('[escrow-reconciliation] Failed to acquire Redis global lock, skipping batch:', err.message);
        return;
      }
      if (!globalLockAcquired) {
        logger.info('[escrow-reconciliation] Global lock held by another instance, skipping batch pull.');
        return;
      }
    }

    const instanceId = process.env.HOSTNAME || os.hostname();
    const { data: pendingOrders, error } = await orderRepository.findPendingEscrowRefunds();

    if (error) {
      logger.error('[escrow-reconciliation] Failed to load pending refunds:', error.message);
      return;
    }

    for (const order of pendingOrders ?? []) {
      const lockKey = `escrow_lock:${order.id}`;
      const lockValue = await acquireLock(lockKey, 30000);
      if (!lockValue) {
        logger.info(`[escrow-reconciliation] Order ${order.order_display_id} locked by another process (API or Job), skipping.`);
        continue;
      }

      try {
        const retryCount = order.escrow_refund_retry_count ?? 0;
        if (retryCount >= MAX_RETRIES) {
          logger.warn(`[escrow-reconciliation] Order ${order.order_display_id} exceeded max retries (${MAX_RETRIES}), escalating.`);
          continue;
        }

        const { data: claimed, error: claimError } = await orderRepository.claimRefundReconciliation(order.id, instanceId);

        if ((!claimed || (Array.isArray(claimed) && claimed.length === 0)) && !claimError) {
          logger.info(`[escrow-reconciliation] Order ${order.order_display_id} already claimed by another instance, skipping.`);
          continue;
        }

        if (claimError) {
          const { data: existing } = await orderRepository.findOrderById(order.id, 'escrow_status, reconciled_by');
          if (existing && (existing.escrow_status !== 'refund_pending' || existing.reconciled_by)) {
            logger.info(`[escrow-reconciliation] Order ${order.order_display_id} already processed, skipping.`);
            continue;
          }
        }

        let refundTxHash = order.refund_tx_hash;
        let receipt;

        if (!refundTxHash) {
          const submitted = await submitEscrowRefund(order.order_display_id);
          receipt = await submitted.waitForConfirmation();
          refundTxHash = receipt.hash ?? submitted.txHash;
        } else {
          receipt = await confirmEscrowRefund(refundTxHash);
        }

        const refundedAt = new Date().toISOString();
        const { error: updateError } = await orderRepository.updateOrderWithFilter(order.id, {
          status: 'cancelled',
          escrow_status: 'refunded',
          refund_tx_hash: receipt.hash ?? refundTxHash,
          escrow_refunded_at: refundedAt,
          escrow_refund_error: null,
          updated_at: refundedAt,
        }, [{ op: 'in', column: 'escrow_status', value: ['refund_pending', 'refund_failed'] }], 'id');

        if (updateError) {
          logger.error(
            `[escrow-reconciliation] Failed to finalize refund for ${order.order_display_id}:`,
            updateError.message
          );
        }
      } catch (err) {
        const newRetryCount = (order.escrow_refund_retry_count ?? 0) + 1;
        await orderRepository.updateOrder(order.id, {
          escrow_refund_retry_count: newRetryCount,
          escrow_refund_error: err.message,
          updated_at: new Date().toISOString(),
        });
        logger.warn(
          `[escrow-reconciliation] Refund for ${order.order_display_id} is not confirmed yet (retry ${newRetryCount}/${MAX_RETRIES}):`,
          err.message
        );
      } finally {
        await releaseLock(lockKey, lockValue);
      }
    }

    if (globalLockAcquired && redisClient) {
      try {
        await redisClient.del(LOCK_KEY);
      } catch (err) {
        logger.warn('[escrow-reconciliation] Failed to release global lock:', err.message);
      }
    }
  } finally {
    reconciliationRunning = false;
  }
}

export function startEscrowRefundReconciliation(orderRepository) {
  if (reconciliationTimer) return;

  const configuredInterval = Number(process.env.ESCROW_RECONCILIATION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  reconciliationTimer = setInterval(() => {
    void reconcilePendingEscrowRefunds(orderRepository);
  }, intervalMs);
  reconciliationTimer.unref?.();
}

export function stopEscrowRefundReconciliation() {
  if (!reconciliationTimer) return;
  clearInterval(reconciliationTimer);
  reconciliationTimer = null;
}