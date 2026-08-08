import { supabaseAdmin } from '../config/db.js';
import { escrowRelease, getEscrowBooking, getEscrowBookingId } from './escrow.js';
import { acquireLock, releaseLock, renewLock, LockAcquisitionError } from '../lib/redisLock.js';
import logger from '../middleware/logger.js';

/**
 * Escrow release reconciliation.
 *
 * Heals the release→finalize failure window: an on-chain release that
 * succeeded but whose `complete_trip_tx` never ran (DB outage, transient RPC
 * error, timeout after commit), leaving the order at `status <> 'payment_released'`
 * with `escrow_status` still `funded`/`release_failed`/`released`.
 *
 * The worker:
 *   1. Takes the global reconciliation lock (UUID owner token via acquireLock).
 *   2. Sweeps `release_failed`/`released`/`funded` orders that are not
 *      finalized, taking the per-order `escrow_lock:<order.id>` (the same key
 *      the OTP confirm flow holds) to avoid racing a live delivery.
 *   3. Consults the on-chain booking (the source of truth for whether the
 *      release happened). If it landed: persists release evidence through the
 *      service-role repository, then calls `complete_trip_tx` (service_role,
 *      no OTP) to finalize the trip and credit the wallet exactly once.
 *      If it did NOT land: retries the release for `release_failed` orders and
 *      leaves `funded` orders alone — a release is never triggered without a
 *      customer OTP confirmation.
 *
 * All writes go through the service-role `orderRepository` — the anon client
 * has no RLS access to `orders`.
 */
const DEFAULT_INTERVAL_MS = 60_000;
const GLOBAL_LOCK_KEY = 'escrow:release:reconciliation:lock';
const GLOBAL_LOCK_TTL_MS = 120_000;
const ORDER_LOCK_TTL_MS = 60_000;
const MAX_RETRIES = 10;

let reconciliationTimer = null;
let reconciliationRunning = false;

/**
 * @param {import('../repositories/orderRepository.js').OrderRepository} orderRepository
 *   MUST be a service-role-backed repository (OrderRepository(supabaseAdmin)).
 */
export async function reconcilePendingEscrowReleases(orderRepository) {
  if (!orderRepository) {
    logger.warn('[escrow-release-reconciliation] No OrderRepository provided — skipping cycle');
    return;
  }
  if (!supabaseAdmin) {
    logger.warn('[escrow-release-reconciliation] supabaseAdmin not available — skipping cycle');
    return;
  }
  if (reconciliationRunning) {
    logger.warn('[escrow-release-reconciliation] Previous cycle still running — skipping.');
    return;
  }
  reconciliationRunning = true;

  let globalLockValue = null;
  try {
    try {
      globalLockValue = await acquireLock(GLOBAL_LOCK_KEY, GLOBAL_LOCK_TTL_MS);
    } catch (err) {
      if (err instanceof LockAcquisitionError) {
        logger.warn('[escrow-release-reconciliation] Redis unavailable — skipping cycle:', err.message);
        return;
      }
      throw err;
    }
  } else {
    // Redis not configured — single-instance mode, use in-process guard only
    if (reconciliationRunning) return;
  }

  try {
    if (!lockAcquired) reconciliationRunning = true;
    const instanceId = process.env.HOSTNAME || os.hostname();
    const { data: failedOrders, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_display_id, escrow_amount_wei, escrow_release_attempts, release_tx_hash')
      .eq('escrow_status', 'release_failed')
      .lt('escrow_release_attempts', MAX_RETRIES)
      .limit(50);

    if (!globalLockValue) {
      logger.info('[escrow-release-reconciliation] Global lock held by another instance, skipping batch.');
      return;
    }

    const { data: pendingOrders, error } = await orderRepository.findPendingEscrowReleases();
    if (error) {
      logger.error('[escrow-release-reconciliation] Failed to load pending release orders:', error.message);
      return;
    }

    for (const order of pendingOrders ?? []) {
      await renewLock(GLOBAL_LOCK_KEY, globalLockValue, GLOBAL_LOCK_TTL_MS);

      const orderLockKey = `escrow_lock:${order.id}`;
      const orderLockValue = await acquireLock(orderLockKey, ORDER_LOCK_TTL_MS);
      if (!orderLockValue) {
        logger.info(`[escrow-release-reconciliation] Order ${order.order_display_id} locked by another process, skipping.`);
        continue;
      }

      try {
        await finalizeReleasedOrder(order, orderRepository);
        const { data: claimed, error: claimError } = await supabaseAdmin
          .rpc('claim_release_reconciliation', {
            p_order_id: order.id,
            p_instance_id: instanceId,
          });

        if ((!claimed || (Array.isArray(claimed) && claimed.length === 0)) && !claimError) {
          logger.info(`[escrow-release-reconciliation] Order ${order.order_display_id} already claimed by another instance, skipping.`);
          continue;
        }

        if (claimError) {
          const { data: existing } = await supabaseAdmin
            .from('orders')
            .select('escrow_status, reconciled_by')
            .eq('id', order.id)
            .maybeSingle();
          if (existing && (existing.escrow_status !== 'release_failed' || existing.reconciled_by)) {
            logger.info(`[escrow-release-reconciliation] Order ${order.order_display_id} already processed, skipping.`);
            continue;
          }
        }

        const releaseAttemptedAt = new Date().toISOString();
        const releaseAttempts = (order.escrow_release_attempts || 0) + 1;

        // The expected amount is passed so escrowRelease verifies the on-chain
        // booking amount before submitting the release (defense-in-depth).
        const result = await escrowRelease(order.order_display_id, order.escrow_amount_wei ?? null);
        const { txHash, alreadyReleased } = result;
        if (!txHash && !alreadyReleased) {
          if (result.code === 'DEPOSIT_AMOUNT_MISMATCH') {
            // The on-chain amount will not change by retrying — record the
            // reason and escalate to manual review instead of looping.
            const releaseAttemptedAt = new Date().toISOString();
            const releaseAttempts = (order.escrow_release_attempts || 0) + 1;
            await supabaseAdmin
              .from('orders')
              .update({
                escrow_release_attempts: releaseAttempts,
                escrow_release_last_attempt_at: releaseAttemptedAt,
                escrow_release_error: String(result.error).slice(0, 1000),
                reconciled_by: null,
                updated_at: releaseAttemptedAt,
              })
              .eq('id', order.id);
            logger.error(
              `[escrow-release-reconciliation] Order ${order.order_display_id} on-chain amount mismatch (${result.error}). Escalating to manual review.`
            );
            continue;
          }
          throw new Error('Escrow release did not return a transaction hash');
        }

        const releasedAt = new Date().toISOString();
        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update({
            escrow_status: 'released',
            release_tx_hash: txHash || order.release_tx_hash,
            escrow_release_error: null,
            escrow_released_at: releasedAt,
            escrow_release_attempts: releaseAttempts,
            escrow_release_last_attempt_at: releaseAttemptedAt,
            reconciled_by: null,
            updated_at: releasedAt,
          })
          .eq('id', order.id)
          .in('escrow_status', ['release_failed', 'funded'])
          .eq('reconciled_by', instanceId);

        if (updateError) {
          logger.error(
            `[escrow-release-reconciliation] Failed to finalize release for ${order.order_display_id}:`,
            updateError.message
          );
        } else {
          logger.info(`[escrow-release-reconciliation] Release succeeded for ${order.order_display_id}`);
        }
      } catch (err) {
        logger.error(
          `[escrow-release-reconciliation] Finalization failed for order ${order.order_display_id}:`,
          err.message
        );
        await recordAttemptError(order, orderRepository, err);
      } finally {
        await releaseLock(orderLockKey, orderLockValue);
      }
    }
  } finally {
    reconciliationRunning = false;
    if (globalLockValue) {
      await releaseLock(GLOBAL_LOCK_KEY, globalLockValue);
    }
  }
}

/**
 * Decide whether a swept order's escrow release actually completed on-chain,
 * then finalize the trip (or retry the release for release_failed orders).
 */
async function finalizeReleasedOrder(order, orderRepository) {
  const { data: fresh, error: readError } = await orderRepository.findOrderById(
    order.id,
    'id, order_display_id, status, escrow_status, escrow_disabled, escrow_booking_id, escrow_release_attempts, escrow_release_last_attempt_at, escrow_release_error, release_tx_hash, escrow_released_at'
  );

  if (readError || !fresh) {
    logger.warn(`[escrow-release-reconciliation] Could not re-read order ${order.id}:`, readError?.message);
    return;
  }

  if (fresh.status === 'payment_released') {
    logger.info(`[escrow-release-reconciliation] Order ${fresh.order_display_id} already finalized, skipping.`);
    return;
  }
  if (['cancelled', 'delivered'].includes(fresh.status)) {
    logger.info(`[escrow-release-reconciliation] Order ${fresh.order_display_id} is ${fresh.status}, skipping.`);
    return;
  }

  // The on-chain booking is the source of truth for whether the release happened.
  const booking = await getEscrowBooking(getEscrowBookingId(fresh.order_display_id));
  const chainReleased = Boolean(booking && booking.paid === true);

  if (!chainReleased) {
    if (fresh.escrow_status === 'release_failed') {
      // A previous release attempt failed before the tx landed — retry it.
      const releaseResult = await escrowRelease(fresh.order_display_id);
      if (releaseResult.txHash) {
        await finalizeWithRelease(fresh, releaseResult.txHash, orderRepository);
      } else if (releaseResult.alreadyReleased) {
        await finalizeWithRelease(fresh, fresh.release_tx_hash, orderRepository);
      } else {
        throw new Error(releaseResult.error || 'Escrow release returned no transaction hash');
      }
    } else {
      // funded/released-but-not-on-chain: the delivery has not been OTP-confirmed.
      // Never auto-release — wait for the confirm-otp flow.
      logger.info(
        `[escrow-release-reconciliation] Order ${fresh.order_display_id} not released on-chain (escrow_status=${fresh.escrow_status}), skipping.`
      );
    }
    return;
  }

  // Release confirmed on-chain → persist evidence and finalize exactly once.
  await finalizeWithRelease(fresh, fresh.release_tx_hash, orderRepository, true);
}

/**
 * Persist the release evidence via the service-role repository, then run
 * `complete_trip_tx` (service_role, no OTP) which is idempotent on
 * `status = 'payment_released'` and credits the wallet exactly once.
 */
async function finalizeWithRelease(order, txHash, orderRepository, chainConfirmed = false) {
  const releasedAt = new Date().toISOString();

  const { error: persistErr } = await orderRepository.updateOrder(order.id, {
    escrow_status: 'released',
    escrow_release_error: null,
    escrow_released_at: releasedAt,
    ...(txHash ? { release_tx_hash: txHash } : {}),
    updated_at: releasedAt,
  });

  if (persistErr) {
    throw new Error(`Failed to persist release evidence: ${persistErr.message}`);
  }

  const rpcResult = await orderRepository.executeRpc(
    'complete_trip_tx',
    {
      p_order_id: order.id,
      p_otp_id: null,
      p_release_tx_hash: txHash,
    },
    supabaseAdmin
  );

  if (rpcResult.error) {
    // Fail closed: if the gate rejects (e.g. escrow_status never persisted as
    // 'released'), do NOT credit — the row keeps retrying.
    throw new Error(`complete_trip_tx failed: ${rpcResult.error.message}`);
  }

  logger.info(
    `[escrow-release-reconciliation] Order ${order.order_display_id} released on-chain${chainConfirmed ? ' (already released)' : ''} and finalized; driver wallet credited.`
  );
}

/**
 * Record a failed reconciliation attempt and bump the retry budget. Orders
 * that exceed MAX_RETRIES drop out of the sweep for manual review.
 */
async function recordAttemptError(order, orderRepository, err) {
  const attempts = (order.escrow_release_attempts ?? 0) + 1;
  const { error } = await orderRepository.updateOrder(order.id, {
    escrow_release_attempts: attempts,
    escrow_release_last_attempt_at: new Date().toISOString(),
    escrow_release_error: String(err.message || 'Unknown error').slice(0, 1000),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    logger.error(`[escrow-release-reconciliation] Failed to record attempt error for order ${order.id}:`, error.message);
    return;
  }

  if (attempts >= MAX_RETRIES) {
    logger.error(
      `[escrow-release-reconciliation] Order ${order.order_display_id} failed ${attempts} times. Escalating to manual review.`
    );
  } else {
    logger.warn(
      `[escrow-release-reconciliation] Reconciliation retry ${attempts}/${MAX_RETRIES} for order ${order.order_display_id}: ${err.message}`
    );
  }
}

/**
 * @param {import('../repositories/orderRepository.js').OrderRepository} orderRepository
 *   A service-role-backed repository (OrderRepository(supabaseAdmin)).
 */
export function startEscrowReleaseReconciliation(orderRepository) {
  if (reconciliationTimer) return;

  const configuredInterval = Number(process.env.ESCROW_RELEASE_RECONCILIATION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  reconciliationTimer = setInterval(() => {
    void reconcilePendingEscrowReleases(orderRepository);
  }, intervalMs);
  reconciliationTimer.unref?.();
  logger.info(`[escrow-release-reconciliation] Worker started (interval ${intervalMs}ms).`);
}

export function stopEscrowReleaseReconciliation() {
  if (!reconciliationTimer) return;
  clearInterval(reconciliationTimer);
  reconciliationTimer = null;
}
