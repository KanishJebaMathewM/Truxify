import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { confirmEscrowRefund, submitEscrowRefund, submitEscrowCancelWithPenalty, paisaToMaticWei, getEscrowBooking, getEscrowBookingId } from './escrow.js';
import { acquireLock, renewLock, releaseLock, withLockRenewal } from '../lib/redisLock.js';
import os from 'os';

const RECONCILIATION_EVENTS = {
  STARTED: 'reconciliation:started',
  COMPLETED: 'reconciliation:completed',
  FAILED: 'reconciliation:failed',
  CLAIMED: 'reconciliation:claimed',
  SKIPPED: 'reconciliation:skipped',
};

const DEFAULT_INTERVAL_MS = 60_000;
const LOCK_KEY = 'escrow:reconciliation:lock';
const LOCK_TTL_SECONDS = 120;
const LEASE_EXTENSION_INTERVAL_MS = (LOCK_TTL_SECONDS * 1000) / 2;
const MAX_RETRIES = 10;
const BASE_BACKOFF_MS = 60_000; // Base backoff for exponential retries (1 minute)
// Lease for a claimed refund reconciliation. If the worker crashes between
// claim and finalize, the claim becomes reclaimable once this lease expires so
// the refund is not frozen forever (issue #14694). Kept long enough to cover
// the on-chain refund confirmation window for a live worker.
const CLAIM_LEASE_SECONDS = 900;
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcilePendingEscrowRefunds(orderRepository) {
  if (!orderRepository) {
    throw new Error('reconcilePendingEscrowRefunds requires an OrderRepository instance');
  }
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  let globalLockValue = null;

  try {
    if (redisClient) {
      try {
        // Use the owner-token pattern so the lock can only be extended or
        // released by its owner (issue #14681). The previous unconditional
        // `expire`/`del` let two sweeps run at once.
        globalLockValue = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS * 1000);
      } catch (err) {
        logger.warn({ err }, '[escrow-reconciliation] Failed to acquire reconciliation lock, proceeding without lock');
      }
      if (!globalLockValue) {
        logger.info('[escrow-reconciliation] Global lock held by another instance, skipping batch pull.');
        return;
      }
    }

    const instanceId = process.env.HOSTNAME || os.hostname();
    const { data: pendingOrders, error } = await orderRepository.findPendingEscrowRefunds();

    if (error) {
      logger.error('[escrow-reconciliation] Failed to load pending refunds:', error?.message ?? String(error));
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
          logger.info({ event: 'ESCROW_BACKOFF', orderId: order.order_display_id, retryCount, nextRetryTime: new Date(nextRetryTime).toISOString() }, '[escrow-reconciliation] Order in backoff period, skipping');
          continue;
        }
      }

      if (globalLockValue) {
        try {
          await renewLock(LOCK_KEY, globalLockValue, LOCK_TTL_SECONDS * 1000);
        } catch (err) {
          logger.warn({ err }, '[escrow-reconciliation] Failed to refresh lock');
        }
      }

      const lockKey = `escrow_lock:${order.id}`;
      const lockValue = await acquireLock(lockKey, 120000);
      if (!lockValue) {
        logger.info({ event: 'ESCROW_LOCK_SKIP', orderId: order.order_display_id }, '[escrow-reconciliation] Order locked by another process, skipping');
        continue;
      }

      try {
        const retryCount = order.escrow_refund_attempts ?? 0;
        if (retryCount >= MAX_RETRIES) {
          logger.warn({ event: 'ESCROW_MAX_RETRIES', orderId: order.order_display_id, maxRetries: MAX_RETRIES }, '[escrow-reconciliation] Order exceeded max retries, escalating');
          continue;
        }

        const { data: claimed, error: claimError } = await orderRepository.claimRefundReconciliation(order.id, instanceId, CLAIM_LEASE_SECONDS);

        if ((!claimed || (Array.isArray(claimed) && claimed.length === 0)) && !claimError) {
          logger.info({ event: 'ESCROW_ALREADY_CLAIMED', orderId: order.order_display_id }, '[escrow-reconciliation] Order already claimed, skipping');
          continue;
        }

        if (claimError) {
          const { data: existing } = await orderRepository.findOrderById(order.id, 'escrow_status, reconciled_by');
          if (existing && (existing.escrow_status !== 'refund_pending' || existing.reconciled_by)) {
            logger.info({ event: 'ESCROW_ALREADY_PROCESSED', orderId: order.order_display_id }, '[escrow-reconciliation] Order already processed, skipping');
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

          // Defense-in-depth for issue #8891: a started trip must never take
          // the full-refund cancelBooking path (the contract now reverts, but
          // verify on-chain state first so we fail fast with a clear reason
          // instead of submitting a transaction that will revert on-chain.
          // When the trip is started, route through cancelWithPenalty even if
          // cancellation_fee is 0 so the driver is compensated; if no fee can
          // be derived, refuse to refund and leave the order for review.
          if (driverFeeWei === 0n) {
            const onChainBooking = await getEscrowBooking(getEscrowBookingId(order.order_display_id));
            if (onChainBooking?.started) {
              throw new Error(
                `Escrow refund for ${order.order_display_id} aborted: on-chain booking is already started ` +
                `(issue #8891) — full refund via cancelBooking is blocked; route through cancelWithPenalty.`
              );
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
          // Keep the per-order lock alive while the (slow) on-chain
          // confirmation runs, otherwise the TTL can lapse mid-transaction and
          // a concurrent sweep double-submits the refund (issue #14681).
          receipt = await withLockRenewal(lockKey, lockValue, 120000, async () => {
            const r = await submitted.waitForConfirmation();
            return r;
          });
          refundTxHash = receipt.hash ?? submitted.txHash;

          // Persist the on-chain tx hash immediately after submission (issue
          // #14694). If the worker crashes before finalize, a later re-claim
          // will find refund_tx_hash already set and take the idempotent
          // confirmEscrowRefund path instead of submitting a duplicate refund.
          // Refreshing reconciled_at also keeps the lease alive while we wait.
          const persistedAt = new Date().toISOString();
          await orderRepository.updateOrder(order.id, {
            refund_tx_hash: refundTxHash,
            reconciled_at: persistedAt,
            updated_at: persistedAt,
          });
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
    if (globalLockValue) {
      try {
        await releaseLock(LOCK_KEY, globalLockValue);
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