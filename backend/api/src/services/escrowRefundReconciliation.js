import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { confirmEscrowRefund, submitEscrowRefund, submitEscrowCancelWithPenalty, paisaToMaticWei, getEscrowBooking, getEscrowBookingId } from './escrow.js';
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
const BASE_BACKOFF_MS = 60_000; // Base backoff for exponential retries (1 minute)
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcilePendingEscrowRefunds(orderRepository) {
  if (!orderRepository) {
    throw new Error('reconcilePendingEscrowRefunds requires an OrderRepository instance');
  }
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  let globalLockAcquired = false;

  try {
    if (redisClient) {
      try {
        globalLockAcquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      } catch (err) {
        logger.warn({ err }, '[escrow-reconciliation] Failed to acquire reconciliation lock, proceeding without lock');
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
      const retryCount = order.escrow_refund_attempts ?? 0;

      // Exponential backoff logic based on updated_at
      if (retryCount > 0 && order.updated_at) {
        const updatedAtTime = new Date(order.updated_at).getTime();
        const backoffMs = Math.pow(2, retryCount - 1) * BASE_BACKOFF_MS;
        const nextRetryTime = updatedAtTime + backoffMs;

        if (Date.now() < nextRetryTime) {
          logger.info(`[escrow-reconciliation] Order ${order.order_display_id} in backoff period (retry ${retryCount}), skipping until ${new Date(nextRetryTime).toISOString()}`);
          continue;
        }
      }

      if (globalLockAcquired && redisClient) {
        try {
          await redisClient.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        } catch (err) {
          logger.warn('[escrow-reconciliation] Failed to refresh lock:', err.message);
        }
      }

      const lockKey = `escrow_lock:${order.id}`;
      const lockValue = await acquireLock(lockKey, 30000);
      if (!lockValue) {
        logger.info(`[escrow-reconciliation] Order ${order.order_display_id} locked by another process (API or Job), skipping.`);
        continue;
      }

      try {
        const retryCount = order.escrow_refund_attempts ?? 0;
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
          // Issue #8891: verify the on-chain booking state before choosing the
          // cancel path. TruxifyEscrow.cancelBooking now reverts for started
          // bookings, and cancelWithPenalty also reverts on started bookings,
          // so submitting either would waste gas and revert on every retry.
          // Escalate for manual review instead of retrying forever.
          const escrowBooking = await getEscrowBooking(getEscrowBookingId(order.order_display_id));
          if (escrowBooking && escrowBooking.started) {
            logger.error(
              `[escrow-reconciliation] Order ${order.order_display_id} booking is started on-chain — full-refund/penalty cancel is not allowed; escalating to manual review.`
            );
            await orderRepository.updateOrder(order.id, {
              escrow_refund_attempts: MAX_RETRIES,
              escrow_refund_error: 'Booking started on-chain — cancel/refund reverted; requires manual review.',
              reconciled_by: null,
              updated_at: new Date().toISOString(),
            });
            continue;
          }

          const cancellationFee = Number(order.cancellation_fee ?? 0);
          let driverFeeWei = 0n;
          if (cancellationFee > 0) {
            // Prefer proportional wei from escrow_amount_wei when available so
            // on-chain penalty matches the fee used at cancel time.
            if (order.escrow_amount_wei != null && order.total_amount) {
              const totalAmount = Number(order.total_amount);
              if (Number.isFinite(totalAmount) && totalAmount > 0) {
                driverFeeWei = (BigInt(order.escrow_amount_wei) * BigInt(cancellationFee)) / BigInt(Math.round(totalAmount));
              }
            }
            if (driverFeeWei === 0n) {
              driverFeeWei = paisaToMaticWei(cancellationFee);
            }
          }

          const submitted = driverFeeWei > 0n
            ? await submitEscrowCancelWithPenalty(order.order_display_id, driverFeeWei)
            : await submitEscrowRefund(order.order_display_id);
          if (!submitted.waitForConfirmation || !submitted.txHash) {
            // The on-chain refund was not actually submitted/confirmed
            // (cancelBooking / cancelWithPenalty threw or the contract is not
            // configured). Never finalize the order as refunded in that case —
            // keep it in refund_pending/refund_failed so the retry loop can heal it.
            throw new Error(
              submitted.error ||
              `Escrow refund for ${order.order_display_id} could not be submitted on-chain (no confirmation available).`
            );
          }
          receipt = await submitted.waitForConfirmation();
          refundTxHash = receipt.hash ?? submitted.txHash;
        } else {
          receipt = await confirmEscrowRefund(refundTxHash);
        }

        if (!refundTxHash) {
          throw new Error(`Escrow refund for ${order.order_display_id} has no confirmed on-chain refund transaction hash.`);
        }

        const refundedAt = new Date().toISOString();
        const { error: updateError } = await orderRepository.updateOrderWithFilter(order.id, {
          status: 'cancelled',
          escrow_status: 'refunded',
          refund_tx_hash: receipt.hash ?? refundTxHash,
          escrow_refunded_at: refundedAt,
          escrow_refund_error: null,
          reconciled_by: null,
          updated_at: refundedAt,
        }, [{ op: 'in', column: 'escrow_status', value: ['refund_pending', 'refund_failed'] }, { op: 'eq', column: 'reconciled_by', value: instanceId }], 'id');

        if (updateError) {
          logger.error(
            `[escrow-reconciliation] Failed to finalize refund for ${order.order_display_id}:`,
            updateError.message
          );
        }
      } catch (err) {
        const newRetryCount = (order.escrow_refund_attempts ?? 0) + 1;
        await orderRepository.updateOrder(order.id, {
          escrow_refund_attempts: newRetryCount,
          escrow_refund_error: err.message,
          reconciled_by: null,
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
  } finally {
    if (globalLockAcquired && redisClient) {
      try {
        await redisClient.del(LOCK_KEY);
      } catch (err) {
        logger.warn('[escrow-reconciliation] Failed to release global lock:', err.message);
      }
    }
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