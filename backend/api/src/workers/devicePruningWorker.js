import cron from 'node-cron';
import logger from '../middleware/logger.js';
import { supabaseAdmin, redisClient } from '../config/db.js';
import { WorkerTracer } from '../core/telemetry/WorkerTracer.js';

let devicePruningTask = null;
let devicePruningRunning = false;

// Distributed lock: only ONE replica may run the daily sweep at a time.
// Same pattern as staleOrderWorker / escrow reconciliations.
const LOCK_KEY = 'device:pruning:lock';
const LOCK_TTL_SECONDS = 600;

const DEFAULT_STALE_DEVICE_DAYS = 90;
const DEFAULT_BATCH_SIZE = 200;

/**
 * Daily stale-device sweep.
 *
 * Deactivates active devices whose last_seen (registration or last successful
 * delivery) is older than the configured threshold. The policy is safe by
 * construction:
 *   - only ACTIVE rows are considered (idempotent — re-running never double-
 *     counts, and already-deactivated rows are never touched again),
 *   - the device row is deactivated, never deleted, preserving audit history,
 *   - batches are bounded to avoid unbounded per-sweep writes.
 */
export async function pruneStaleDevices() {
  if (devicePruningRunning) return;
  devicePruningRunning = true;
  let globalLockAcquired = false;

  try {
    if (redisClient) {
      try {
        globalLockAcquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      } catch (err) {
        logger.error('[DevicePruning] Failed to acquire Redis lock, skipping sweep:', err.message);
        return;
      }
      if (!globalLockAcquired) {
        logger.info('[DevicePruning] Global lock held by another replica, skipping sweep.');
        return;
      }
    }

    if (!supabaseAdmin) {
      logger.warn('[DevicePruning] Service-role client not configured — skipping sweep.');
      return;
    }

    const staleDays = Number(process.env.DEVICE_STALE_THRESHOLD_DAYS) || DEFAULT_STALE_DEVICE_DAYS;
    const batchSize = Number(process.env.DEVICE_PRUNE_BATCH_SIZE) || DEFAULT_BATCH_SIZE;
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

    // Bounded candidate fetch; the guarded UPDATE below is the idempotency gate.
    const { data: candidates, error: fetchError } = await supabaseAdmin
      .from('user_devices')
      .select('id')
      .eq('is_active', true)
      .lt('last_seen', cutoff)
      .limit(batchSize);

    if (fetchError) {
      logger.error(`[DevicePruning] Failed to fetch stale devices: ${fetchError.message}`);
      return;
    }

    const ids = (candidates ?? []).map((d) => d.id);
    if (ids.length === 0) {
      logger.info('[DevicePruning] No stale devices found.');
      return;
    }

    const { error: updateError } = await supabaseAdmin
      .from('user_devices')
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
      })
      .in('id', ids)
      .eq('is_active', true);

    if (updateError) {
      logger.error(`[DevicePruning] Failed to deactivate stale devices: ${updateError.message}`);
      return;
    }

    logger.info(`[DevicePruning] Deactivated ${ids.length} stale device(s) (threshold ${staleDays}d, cutoff ${cutoff}).`);
  } catch (err) {
    logger.error(`[DevicePruning] Unexpected error during sweep: ${err.message}`);
  } finally {
    if (globalLockAcquired && redisClient) {
      try {
        await redisClient.del(LOCK_KEY);
      } catch (err) {
        logger.warn('[DevicePruning] Failed to release global lock:', err.message);
      }
    }
    devicePruningRunning = false;
  }
}

export const startDevicePruningWorker = () => {
  if (devicePruningTask) {
    logger.info('[DevicePruning] Stale device pruning cron job already scheduled.');
    return devicePruningTask;
  }

  const tracedHandler = WorkerTracer.wrapCronJob('device-pruning-worker', async () => {
    await pruneStaleDevices();
  }, { schedule: '15 3 * * *' });

  // Run every day at 03:15
  devicePruningTask = cron.schedule('15 3 * * *', tracedHandler);

  logger.info('[DevicePruning] Stale device pruning cron job scheduled (runs daily at 03:15).');
  return devicePruningTask;
};

export const stopDevicePruningWorker = () => {
  if (!devicePruningTask) return;
  devicePruningTask.stop();
  devicePruningTask = null;
  logger.info('[DevicePruning] Stale device pruning cron job stopped.');
};
