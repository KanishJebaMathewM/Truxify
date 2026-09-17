import { supabaseAdmin, redisClient } from '../config/db.js';
import { awardReputationPoints } from './reputation.js';
import logger from '../middleware/logger.js';
import os from 'os';

const DEFAULT_INTERVAL_MS = 60_000;
const LOCK_KEY = 'reputation:reconciliation:lock';
const LOCK_TTL_SECONDS = 120;
const LEASE_EXTENSION_INTERVAL_MS = (LOCK_TTL_SECONDS * 1000) / 2;
const MAX_RETRIES = 10;
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcileFailedReputationUpdates() {
  if (!supabaseAdmin) {
    logger.warn('[reputation-reconciliation] supabaseAdmin not available — skipping cycle');
    return;
  }

  let lockAcquired = false;
  let leaseExtender = null;

  if (redisClient) {
    try {
      const acquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      if (!acquired) {
        logger.info('[reputation-reconciliation] Lock held by another instance, skipping.');
        return;
      }
      lockAcquired = true;
      leaseExtender = setInterval(async () => {
        try {
          await redisClient.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        } catch (err) {
          logger.warn('[reputation-reconciliation] Failed to extend lock lease:', err.message);
        }
      }, LEASE_EXTENSION_INTERVAL_MS);
    } catch (err) {
      logger.error('[reputation-reconciliation] Failed to acquire Redis lock, skipping batch:', err.message);
      return;
    }
  } else {
    // Redis not configured — single-instance mode, use in-process guard only
  }

  if (!lockAcquired) {
    if (reconciliationRunning) return;
    reconciliationRunning = true;
  }

  try {
    const instanceId = process.env.HOSTNAME || os.hostname();
    const { data: failedReputations, error } = await supabaseAdmin
      .from('reputation_failures')
      .select('*')
      .or('status.in.(pending,submitted),status.is.null')
      .lt('retry_count', MAX_RETRIES)
      .limit(50);

    if (error) {
      logger.warn('[reputation-reconciliation] Failed to load reputation failures (table may not exist yet):', error.message);
      return;
    }

    if (!failedReputations || failedReputations.length === 0) {
      return;
    }

    for (const row of failedReputations ?? []) {
      let claimKey;
      if (redisClient) {
        claimKey = `reputation:claim:${row.id}`;
        const claimed = await redisClient.set(claimKey, instanceId, 'NX', 'EX', 300);
        if (!claimed) {
          logger.info(`[reputation-reconciliation] Row ${row.id} already claimed, skipping.`);
          continue;
        }
      }

      const awardKey = row.award_key || `reputation:failure:${row.id}`;
      const existingTxHash = row.tx_hash || null;

      try {
        // Award or resolve existing transaction idempotently
        const result = await awardReputationPoints(row.driver_wallet, row.stars, {
          awardKey,
          existingTxHash,
        });

        // 1. Mark as confirmed in DB first so subsequent queries never re-process it
        const confirmedTxHash = result?.txHash || existingTxHash || null;
        await supabaseAdmin
          .from('reputation_failures')
          .update({
            status: 'confirmed',
            tx_hash: confirmedTxHash,
            confirmed_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        // 2. Clean up confirmed row
        const { error: deleteError } = await supabaseAdmin
          .from('reputation_failures')
          .delete()
          .eq('id', row.id);

        if (deleteError) {
          logger.warn(
            `[reputation-reconciliation] Failed to delete confirmed row ${row.id} (marked confirmed in DB): ${deleteError.message}`
          );
        }

        logger.info(`[reputation-reconciliation] Successfully retried reputation update for ${row.driver_wallet}`);
      } catch (err) {
        logger.warn(`[reputation-reconciliation] Reputation update failed for ${row.driver_wallet}: ${err?.message ?? String(err)}`);
        const newRetryCount = (row.retry_count ?? 0) + 1;
        const nextStatus = err.txHash
          ? 'submitted'
          : (newRetryCount >= MAX_RETRIES ? 'failed' : (row.status || 'pending'));

        await supabaseAdmin.from('reputation_failures').update({
          status: nextStatus,
          tx_hash: err.txHash || row.tx_hash || null,
          retry_count: newRetryCount,
          last_error: err?.message ?? String(err),
          last_attempt_at: new Date().toISOString(),
        }).eq('id', row.id);

        logger.warn(`[reputation-reconciliation] Retry ${newRetryCount}/${MAX_RETRIES} updated status to ${nextStatus} for ${row.driver_wallet}: ${err?.message ?? String(err)}`);
      } finally {
        // Release the per-row claim so a re-queued failure can be retried on
        // the next cycle instead of waiting for the 300s claim TTL to expire.
        if (claimKey && redisClient) {
          try {
            await redisClient.del(claimKey);
          } catch (err) {
            logger.warn(`[reputation-reconciliation] Failed to release claim for ${row.id}:`, err.message);
          }
        }
      }
    }
  } finally {
    if (leaseExtender) {
      clearInterval(leaseExtender);
    }

    if (lockAcquired && redisClient) {
      try {
        await redisClient.del(LOCK_KEY);
        logger.debug('[reputation-reconciliation] Lock released successfully');
      } catch (err) {
        logger.error(
          { err, lockKey: LOCK_KEY },
          'Failed to release reputation reconciliation lock'
        );
      }
    }

    // Always reset running flag so fallback/single-instance logic doesn't permanently deadlock
    reconciliationRunning = false;
  }
}
export function startReputationReconciliation() {
  if (reconciliationTimer) return;

  const configuredInterval = Number(process.env.REPUTATION_RECONCILIATION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  reconciliationTimer = setInterval(() => {
    void reconcileFailedReputationUpdates();
  }, intervalMs);
  reconciliationTimer.unref?.();
}

export function stopReputationReconciliation() {
  if (!reconciliationTimer) return;
  clearInterval(reconciliationTimer);
  reconciliationTimer = null;}