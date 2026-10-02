import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
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

const DEFAULT_MAX_BATCHES = 10;


const RENEW_LEASE = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
  end
  return 0
`;
const RELEASE_LEASE = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

function boundedSetting(name, fallback, maximum) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), maximum)
    : fallback;
}

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
  const leaseClient = redisClient;
  const databaseClient = supabaseAdmin;
  const leaseToken = randomUUID();
  let globalLockAcquired = false;
  let deactivated = 0;
  let batches = 0;

  // A failed/expired lease never becomes owned again during this run.
  async function retainLease() {
    if (!leaseClient) return true; // Process-local guard remains active.
    try {
      const retained = await leaseClient.eval(RENEW_LEASE, 1, LOCK_KEY, leaseToken, LOCK_TTL_SECONDS);
      if (Number(retained) === 1) return true;
      logger.warn('[DevicePruning] Lease ownership lost; stopping further batch work.');
    } catch (err) {
      logger.warn({ err }, '[DevicePruning] Lease renewal failed; stopping further batch work.');
    }
    return false;
  }

  try {
    if (!databaseClient) {
      logger.warn('[DevicePruning] Service-role client not configured — skipping sweep.');
      return;
    }
    if (leaseClient) {
      try {
        globalLockAcquired = await leaseClient.set(LOCK_KEY, leaseToken, 'NX', 'EX', LOCK_TTL_SECONDS) === 'OK';
      } catch (err) {
        logger.error({ err }, '[DevicePruning] Failed to acquire Redis lock, skipping sweep.');
        return;
      }
      if (!globalLockAcquired) {
        logger.info('[DevicePruning] Global lock held by another replica, skipping sweep.');
        return;
      }
    }

    const staleDays = boundedSetting('DEVICE_STALE_THRESHOLD_DAYS', DEFAULT_STALE_DEVICE_DAYS, 3650);
    const batchSize = boundedSetting('DEVICE_PRUNE_BATCH_SIZE', DEFAULT_BATCH_SIZE, 1000);
    const maxBatches = boundedSetting('DEVICE_PRUNE_MAX_BATCHES', DEFAULT_MAX_BATCHES, 100);
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

    for (let batch = 0; batch < maxBatches; batch++) {
      if (!await retainLease()) return;
      const { data: candidates, error: fetchError } = await databaseClient
        .from('user_devices')
        .select('id')
        .eq('is_active', true)
        .lt('last_seen', cutoff)
        .order('last_seen', { ascending: true })
        .order('id', { ascending: true })
        .limit(batchSize);
      if (fetchError) {
        logger.error({ err: fetchError }, '[DevicePruning] Failed to fetch stale devices.');
        return;
      }
      const ids = (candidates ?? []).map((device) => device.id);
      if (ids.length === 0) break;
      if (!await retainLease()) return;

      // Redis and PostgreSQL are not one transaction. An already-dispatched
      // UPDATE may finish after lease loss; freshness is guarded in the UPDATE.
      const { data: updated, error: updateError } = await databaseClient
        .from('user_devices')
        .update({ is_active: false, deactivated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('is_active', true)
        .lt('last_seen', cutoff)
        .select('id');
      if (updateError) {
        logger.error({ err: updateError }, '[DevicePruning] Failed to deactivate stale devices.');
        return;
      }
      deactivated += updated?.length ?? 0;
      batches++;
      // Requery the first eligible page: deactivated/refreshed rows disappear.
      // Do not offset past remaining rows in a mutating candidate set.
    }
    logger.info({ deactivated, batches, maxBatches, batchSize, staleDays, cutoff },
      '[DevicePruning] Bounded stale-device sweep completed.');
  } catch (err) {
    logger.error({ err }, '[DevicePruning] Unexpected error during sweep.');
  } finally {
    if (globalLockAcquired && leaseClient) {
      try {
        await leaseClient.eval(RELEASE_LEASE, 1, LOCK_KEY, leaseToken);
      } catch (err) {
        logger.warn({ err }, '[DevicePruning] Failed to release own global lock.');
      }
    }
    // Keep ownership through actual query/update settlement, including failure.
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
