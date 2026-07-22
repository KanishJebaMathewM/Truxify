import { supabase, redisClient } from '../config/db.js';
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
      reconciliationRunning = true;
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
    // Without Redis there is no distributed lock and no per-row claim key, so
    // multiple service instances would reconcile the same rows concurrently and
    // double-award reputation. In that case skip rather than run unprotected.
    if (!redisClient) {
      logger.error('[reputation-reconciliation] Redis unavailable: cannot acquire a distributed lock. Skipping reconciliation to avoid unsafe concurrent awards across instances.');
      return;
    }
    if (reconciliationRunning) return;
    reconciliationRunning = true;
  }

  try {
    const instanceId = process.env.HOSTNAME || os.hostname();
    const { data: failedReputations, error } = await supabase
      .from('reputation_failures')
      .select('*')
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
      let claimError;
      if (redisClient) {
        const claimKey = `reputation:claim:${row.id}`;
        const claimed = await redisClient.set(claimKey, instanceId, 'NX', 'EX', 300);
        if (!claimed) {
          logger.info(`[reputation-reconciliation] Row ${row.id} already claimed, skipping.`);
          continue;
        }
      }

      try {
        await awardReputationPoints(row.driver_wallet, row.stars);
        const { error: deleteError } = await supabase.from('reputation_failures').delete().eq('id', row.id);
        if (deleteError) {
          throw new Error(`Award succeeded but failed to delete reconciled reputation failure ${row.id}: ${deleteError.message}`);
        }
        logger.info(`[reputation-reconciliation] Successfully retried reputation update for ${row.driver_wallet}`);
      } catch (err) {
        const newRetryCount = (row.retry_count ?? 0) + 1;
        await supabase.from('reputation_failures').update({
          retry_count: newRetryCount,
          last_error: err.message,
          last_attempt_at: new Date().toISOString(),
        }).eq('id', row.id);
        logger.warn(`[reputation-reconciliation] Retry ${newRetryCount}/${MAX_RETRIES} failed for ${row.driver_wallet}: ${err.message}`);
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
  reconciliationTimer = null;
}
