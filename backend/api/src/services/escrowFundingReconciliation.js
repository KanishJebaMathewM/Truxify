import { redisClient, supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { submitEscrowRefund, getEscrowBooking } from './escrow.js';
import { acquireLock, releaseLock } from '../lib/redisLock.js';
import { sendPushNotification } from './notificationService.js';

// Two-phase acceptance sweeper (#5724): orders that reached escrow_status
// 'funding' but whose escrow deposit never lands within the funding TTL are
// automatically reverted (driver released, order back to pending, deposit
// refunded if one was actually made on-chain).
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_FUNDING_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 60_000;
const LOCK_KEY = 'escrow:funding:reconciliation:lock';
const LOCK_TTL_SECONDS = 120;

let fundingTimer = null;
let fundingRunning = false;

function dueForRetry(order) {
  const attempts = order.escrow_funding_attempts ?? 0;
  if (attempts === 0 || !order.escrow_funding_last_attempt_at) return true;
  const backoffMs = Math.pow(2, attempts - 1) * BASE_BACKOFF_MS;
  const nextRetryTime = new Date(order.escrow_funding_last_attempt_at).getTime() + backoffMs;
  return Date.now() >= nextRetryTime;
}

async function finalizeOrRevert(order, orderRepository) {
  const lockKey = `escrow_lock:${order.id}`;
  const lockValue = await acquireLock(lockKey, 30000);
  if (!lockValue) {
    logger.info(`[escrow-funding] Order ${order.order_display_id} locked by another process, skipping.`);
    return;
  }

  try {
    const booking = await getEscrowBooking(order.escrow_booking_id);
    const bookingAmount = booking?.amount;
    const bookingFunded = booking && bookingAmount != null && bookingAmount > 0n;

    // An on-chain booking only counts as "the deposit landed" if it is funded
    // with EXACTLY the authoritative amount recorded for the order. A booking
    // funded with any other amount must never finalize the acceptance — the
    // order is reverted and the deposit refunded instead.
    let mismatchReason = null;
    if (bookingFunded && order.escrow_amount_wei != null) {
      const expectedWei = BigInt(order.escrow_amount_wei);
      if (bookingAmount !== expectedWei) {
        mismatchReason = `booking amount ${bookingAmount} wei does not match expected ${expectedWei} wei`;
        logger.error(`[escrow-funding] Order ${order.order_display_id} ${mismatchReason} — reverting instead of healing.`);
      }
    }

    if (bookingFunded && !mismatchReason && order.status === 'cancelled') {
      logger.info(`[escrow-funding] Order ${order.order_display_id} is cancelled but deposit landed on-chain. Triggering refund.`);
      try {
        await submitEscrowRefund(order.order_display_id);
        await orderRepository.updateOrder(order.id, {
          escrow_status: 'refunded',
          escrow_refund_error: null,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(`[escrow-funding] Failed to refund cancelled order ${order.order_display_id}: ${err.message}`);
        await orderRepository.updateOrder(order.id, {
          escrow_status: 'refund_failed',
          escrow_refund_error: err.message,
          updated_at: new Date().toISOString(),
        });
      }
      return;
    }

    if (bookingFunded && !mismatchReason) {
      // The deposit DID land on-chain with the correct amount. Heal the
      // acceptance by running accept_bid_tx as the backend (service_role).
      const pending = order.pending_bid_acceptance;
      if (pending) {
        const { error: acceptErr } = await orderRepository.executeRpc('accept_bid_tx', {
          p_bid_id: pending.bid_id,
          p_order_id: order.id,
          p_load_id: pending.load_id,
          p_driver_id: pending.driver_id,
          p_truck_id: pending.truck_id,
          p_driver_name: pending.driver_name,
          p_driver_rating: pending.driver_rating,
          p_truck_number: pending.truck_number,
          p_bid_amount: pending.bid_amount,
          p_order_display_id: pending.order_display_id,
          p_expected_version: pending.version,
          p_escrow_booking_id: order.escrow_booking_id,
        }, supabaseAdmin);

        if (acceptErr) {
          logger.warn(`[escrow-funding] Funding healed for ${order.order_display_id} but accept_bid_tx failed: ${acceptErr.message}`);
          await orderRepository.updateOrder(order.id, {
            escrow_funding_attempts: 0,
            escrow_funding_error: acceptErr.message,
            escrow_funding_last_attempt_at: new Date().toISOString(),
          });
          return;
        }

        sendPushNotification(
          pending.driver_id,
          'Bid Accepted!',
          `Your bid for order ${pending.order_display_id} has been accepted. You are now assigned to this load.`,
          'order_update',
          { orderId: order.id, orderDisplayId: pending.order_display_id }
        ).catch((err) => logger.error(`[FCM] Failed to notify driver of bid acceptance: ${err.message}`));
      }

      await orderRepository.updateOrderWithFilter(order.id, {
        escrow_funding_attempts: 0,
        escrow_funding_error: null,
        escrow_funding_last_attempt_at: null,
      }, [{ op: 'eq', column: 'escrow_status', value: 'funding' }], 'id');
      logger.info(`[escrow-funding] Order ${order.order_display_id} funding healed and acceptance finalized.`);
      return;
    }

    // Deposit never landed (or the amount does not match the authoritative
    // figure). Release the driver and refund the incorrect deposit.
    // submitEscrowRefund resolves with { error } / missing txHash on chain
    // failures instead of throwing — only clear funding after confirmation.
    let refundResult;
    try {
      refundResult = await submitEscrowRefund(order.order_display_id);
    } catch (err) {
      refundResult = { txHash: null, error: err.message };
      logger.error(`[escrow-funding] Refund failed for ${order.order_display_id}: ${err.message}`);
    }

    if (refundResult?.error || !refundResult?.txHash) {
      const refundError = refundResult?.error || 'escrow refund was not submitted';
      logger.error(
        `[escrow-funding] Skipping funding clear for ${order.order_display_id}: refund not confirmed (${refundError})`
      );
      await orderRepository.updateOrderWithFilter(order.id, {
        escrow_funding_error: mismatchReason
          ? `ESCROW_AMOUNT_MISMATCH: ${mismatchReason}; refund pending: ${refundError}`
          : `refund pending: ${refundError}`,
        escrow_funding_last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, [
        { op: 'eq', column: 'escrow_status', value: 'funding' },
        { op: 'eq', column: 'id', value: order.id },
      ], 'id').catch((err) => {
        logger.error(`[escrow-funding] Failed to record refund pending for ${order.order_display_id}: ${err.message}`);
      });
      return;
    }

    try {
      await refundResult.waitForConfirmation();
    } catch (err) {
      logger.error(
        `[escrow-funding] Refund confirmation failed for ${order.order_display_id}: ${err.message}`
      );
      await orderRepository.updateOrderWithFilter(order.id, {
        escrow_funding_error: mismatchReason
          ? `ESCROW_AMOUNT_MISMATCH: ${mismatchReason}; refund confirmation failed: ${err.message}`
          : `refund confirmation failed: ${err.message}`,
        escrow_funding_last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, [
        { op: 'eq', column: 'escrow_status', value: 'funding' },
        { op: 'eq', column: 'id', value: order.id },
      ], 'id').catch((stateErr) => {
        logger.error(`[escrow-funding] Failed to record confirmation failure for ${order.order_display_id}: ${stateErr.message}`);
      });
      return;
    }

    const { error: revertErr } = await orderRepository.updateOrderWithFilter(order.id, {
      escrow_status: 'pending',
      escrow_booking_id: null,
      pending_bid_acceptance: null,
      escrow_funding_attempts: 0,
      escrow_funding_last_attempt_at: null,
      escrow_funding_error: mismatchReason
        ? `ESCROW_AMOUNT_MISMATCH: ${mismatchReason}`
        : null,
      updated_at: new Date().toISOString(),
    }, [
      { op: 'eq', column: 'escrow_status', value: 'funding' },
      { op: 'eq', column: 'id', value: order.id },
    ], 'id');

    if (revertErr) {
      logger.error(`[escrow-funding] Failed to revert order ${order.order_display_id}: ${revertErr.message}`);
    } else {
      sendPushNotification(
        order.customer_id,
        'Bid Acceptance Expired',
        `The escrow deposit for order ${order.order_display_id} was not completed in time, so the driver is no longer reserved. You can accept a bid again.`,
        'order_update',
        { orderId: order.id }
      ).catch((err) => logger.error(`[FCM] Failed to notify customer of expired bid acceptance: ${err.message}`));
      logger.info(`[escrow-funding] Order ${order.order_display_id} reverted to pending (funding TTL expired).`);
    }
  } catch (err) {
    const newAttempts = (order.escrow_funding_attempts ?? 0) + 1;
    await orderRepository.updateOrder(order.id, {
      escrow_funding_attempts: newAttempts,
      escrow_funding_error: err.message,
      escrow_funding_last_attempt_at: new Date().toISOString(),
    });
    logger.warn(`[escrow-funding] Order ${order.order_display_id} funding reconciliation retry ${newAttempts}/${MAX_ATTEMPTS}: ${err.message}`);
  } finally {
    await releaseLock(lockKey, lockValue);
  }
}

export async function reconcileStaleFunding(orderRepository) {
  if (!orderRepository) throw new Error('reconcileStaleFunding requires an OrderRepository instance');
  if (fundingRunning) return;
  fundingRunning = true;
  let globalLockAcquired = false;

  try {
    if (redisClient) {
      try {
        globalLockAcquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      } catch (err) {
        logger.error('[escrow-funding] Failed to acquire Redis global lock, skipping batch:', err.message);
        return;
      }
      if (!globalLockAcquired) {
        logger.info('[escrow-funding] Global lock held by another instance, skipping batch.');
        return;
      }
    }

    const ttlMinutes = Number(process.env.ESCROW_FUNDING_TTL_MINUTES);
    const fundingTtlMs = (Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : DEFAULT_FUNDING_TTL_MINUTES) * 60 * 1000;
    const cutoff = new Date(Date.now() - fundingTtlMs).toISOString();

    const { data: staleOrders, error } = await orderRepository.findStaleFundingOrders(cutoff);
    if (error) {
      logger.error('[escrow-funding] Failed to load stale funding orders:', error.message);
      return;
    }

    for (const order of staleOrders ?? []) {
      if (!dueForRetry(order)) continue;
      if (globalLockAcquired && redisClient) {
        try {
          await redisClient.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        } catch (err) {
          logger.warn('[escrow-funding] Failed to refresh lock:', err.message);
        }
      }
      await finalizeOrRevert(order, orderRepository);
    }
  } finally {
    if (globalLockAcquired && redisClient) {
      try {
        await redisClient.del(LOCK_KEY);
      } catch (err) {
        logger.warn('[escrow-funding] Failed to release global lock:', err.message);
      }
    }
    fundingRunning = false;
  }
}

export function startEscrowFundingReconciliation(orderRepository) {
  if (fundingTimer) return;

  const configuredInterval = Number(process.env.ESCROW_FUNDING_RECONCILIATION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  fundingTimer = setInterval(() => {
    void reconcileStaleFunding(orderRepository);
  }, intervalMs);
  fundingTimer.unref?.();
  logger.info(`[escrow-funding] Funding reconciliation worker started (interval ${intervalMs}ms, TTL ${process.env.ESCROW_FUNDING_TTL_MINUTES || DEFAULT_FUNDING_TTL_MINUTES}min).`);
}

export function stopEscrowFundingReconciliation() {
  if (!fundingTimer) return;
  clearInterval(fundingTimer);
  fundingTimer = null;
}
