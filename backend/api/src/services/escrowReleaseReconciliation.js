import { supabaseAdmin, redisClient } from '../config/db.js';
import { escrowRelease } from './escrow.js';
import logger from '../middleware/logger.js';
import os from 'os';
const DEFAULT_INTERVAL_MS = 60_000;
const LOCK_KEY = 'escrow:release:reconciliation:lock';
const LOCK_TTL_SECONDS = 120;
const MAX_RETRIES = 10;
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcilePendingEscrowReleases() {
  if (!supabaseAdmin) {
    logger.warn('[escrow-release-reconciliation] supabaseAdmin not available — skipping cycle');
    return;
  }

  let lockAcquired = false;

  if (redisClient) {
    try {
      const acquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      if (!acquired) {
        logger.info('[escrow-release-reconciliation] Lock held by another instance, skipping.');
        return;
      }
      lockAcquired = true;
    } catch (err) {
      logger.error('[escrow-release-reconciliation] Failed to acquire Redis lock, skipping batch:', err.message);
      return;
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
      .select('id, order_display_id, escrow_release_attempts')
      .eq('escrow_status', 'release_failed')
      .lt('escrow_release_attempts', MAX_RETRIES)
      .limit(50);

    if (error) {
      logger.error('[escrow-release-reconciliation] Failed to load failed releases:', error.message);
      return;
    }

    if (!failedOrders || failedOrders.length === 0) {
      logger.info('[escrow-release-reconciliation] No pending release failures found.');
      return;
    }

    for (const order of failedOrders ?? []) {
      if (lockAcquired && redisClient) {
        try {
          await redisClient.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        } catch (err) {
          logger.warn('[escrow-release-reconciliation] Failed to refresh lock:', err.message);
        }
      }
      try {
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

        const { txHash, alreadyReleased } = await escrowRelease(order.order_display_id);
        if (!txHash && !alreadyReleased) {
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
            updated_at: releasedAt,
          })
          .eq('id', order.id)
      .in('escrow_status', ['release_failed', 'funded'])
          .is('reconciled_by', null);

        if (updateError) {
          logger.error(
            `[escrow-release-reconciliation] Failed to finalize release for ${order.order_display_id}:`,
            updateError.message
          );
        } else {
          logger.info(`[escrow-release-reconciliation] Release succeeded for ${order.order_display_id}`);
        }
      } catch (err) {
        const releaseAttemptedAt = new Date().toISOString();
        const releaseAttempts = (order.escrow_release_attempts || 0) + 1;

        const { error: attemptError } = await supabaseAdmin
          .from('orders')
          .update({
            escrow_release_attempts: releaseAttempts,
            escrow_release_last_attempt_at: releaseAttemptedAt,
            escrow_release_error: String(err.message || 'Unknown error').slice(0, 1000),
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (attemptError) {
          logger.error(
            `[escrow-release-reconciliation] Failed to update attempt count for ${order.order_display_id}:`,
            attemptError.message
          );
        }

        if (releaseAttempts >= MAX_RETRIES) {
          logger.error(
            `[escrow-release-reconciliation] Order ${order.order_display_id} has failed ${releaseAttempts} times. Escalating to manual review.`
          );
        } else {
          const backoffMs = Math.min(1000 * Math.pow(2, releaseAttempts), 60000);
          logger.warn(
            `[escrow-release-reconciliation] Release retry ${releaseAttempts}/${MAX_RETRIES} for ${order.order_display_id} failed. Will retry in ${backoffMs}ms.`
          );
        }
      }
    }
  } finally {
    if (lockAcquired && redisClient) {
      try {
        await redisClient.del(LOCK_KEY);
      } catch (err) {
        logger.warn('[escrow-release-reconciliation] Failed to release Redis lock:', err.message);
      }
    }
    if (!lockAcquired) {
      reconciliationRunning = false;
    }
  }
}

export function startEscrowReleaseReconciliation() {
  if (reconciliationTimer) return;

  const configuredInterval = Number(process.env.ESCROW_RELEASE_RECONCILIATION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  reconciliationTimer = setInterval(() => {
    void reconcilePendingEscrowReleases();
  }, intervalMs);
  reconciliationTimer.unref?.();
}

export function stopEscrowReleaseReconciliation() {
  if (!reconciliationTimer) return;
  clearInterval(reconciliationTimer);
  reconciliationTimer = null;
}
