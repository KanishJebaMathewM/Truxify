import express from 'express';
import { redisClient, supabaseAdmin, mongoDb } from '../config/db.js';
import logger from '../middleware/logger.js';
import { requireApiKey } from '../middleware/apiKey.js';

const router = express.Router();

const LOCK_KEY = 'ml_retrain_lock';

/**
 * POST /api/internal/ml-lock
 * Acquires a distributed lease lock for ML retraining.
 * Body: { execution_id: string, lease_seconds?: number }
 */
router.post('/internal/ml-lock', requireApiKey, async (req, res) => {
  try {
    const { execution_id, lease_seconds = 180 } = req.body;
    if (!execution_id) {
      return res.status(400).json({ error: 'Missing execution_id' });
    }

    if (!redisClient) {
      logger.warn('[MLLock] Redis client unavailable — skipping distributed lock');
      return res.status(200).json({ acquired: true, stale: false, redisAvailable: false });
    }

    // Try acquiring lock using ioredis positional syntax (key, val, 'EX', seconds, 'NX')
    const result = await redisClient.set(LOCK_KEY, String(execution_id), 'EX', Number(lease_seconds), 'NX');

    if (result === 'OK') {
      logger.info(`[MLLock] Lock acquired by execution ${execution_id} for ${lease_seconds}s`);
      return res.status(200).json({ acquired: true, stale: false });
    }

    // Lock was already held — check for stale lease (remaining TTL <= 0)
    const ttl = await redisClient.ttl(LOCK_KEY);
    const currentOwner = await redisClient.get(LOCK_KEY);

    if (currentOwner === String(execution_id)) {
      // Re-acquired by same execution
      await redisClient.expire(LOCK_KEY, Number(lease_seconds));
      return res.status(200).json({ acquired: true, stale: false, reacquired: true });
    }

    if (ttl <= 0) {
      logger.warn(`[MLLock] Reclaiming stale lock (previous owner ${currentOwner}) for execution ${execution_id}`);
      await redisClient.set(LOCK_KEY, String(execution_id), 'EX', Number(lease_seconds));
      return res.status(200).json({ acquired: true, stale: true, previousOwner: currentOwner });
    }

    logger.info(`[MLLock] Lock currently held by execution ${currentOwner} (TTL: ${ttl}s)`);
    return res.status(200).json({ acquired: false, stale: false, currentOwner, remainingTtl: ttl });
  } catch (err) {
    logger.error(`[MLLock] Error acquiring lock: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/internal/ml-lock/renew
 * Heartbeat renewal endpoint to roll lock TTL forward during active training.
 * Body: { execution_id: string, lease_seconds?: number }
 */
router.post('/internal/ml-lock/renew', requireApiKey, async (req, res) => {
  try {
    const { execution_id, lease_seconds = 180 } = req.body;
    if (!execution_id) {
      return res.status(400).json({ error: 'Missing execution_id' });
    }

    if (!redisClient) {
      return res.status(200).json({ renewed: true, redisAvailable: false });
    }

    // Execute atomic Lua script to renew TTL iff current lock owner matches execution_id
    const luaScript = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('expire', KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const renewed = await redisClient.eval(luaScript, 1, LOCK_KEY, String(execution_id), String(lease_seconds));

    if (renewed === 1) {
      logger.debug(`[MLLock] Heartbeat renewed lock for execution ${execution_id} (+${lease_seconds}s)`);
      return res.status(200).json({ renewed: true, executionId: execution_id });
    }

    logger.warn(`[MLLock] Heartbeat renewal rejected — lock owner changed for execution ${execution_id}`);
    return res.status(200).json({ renewed: false, reason: 'owner_mismatch' });
  } catch (err) {
    logger.error(`[MLLock] Error renewing lock: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/internal/ml-lock
 * Releases lock upon job completion or failure.
 * Body: { execution_id: string }
 */
router.delete('/internal/ml-lock', requireApiKey, async (req, res) => {
  try {
    const { execution_id } = req.body;
    if (!execution_id) {
      return res.status(400).json({ error: 'Missing execution_id' });
    }

    if (!redisClient) {
      return res.status(200).json({ released: true, redisAvailable: false });
    }

    // Execute atomic Lua script to release lock iff current owner matches execution_id
    const luaScript = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;

    const released = await redisClient.eval(luaScript, 1, LOCK_KEY, String(execution_id));

    if (released === 1) {
      logger.info(`[MLLock] Lock released cleanly by execution ${execution_id}`);
      return res.status(200).json({ released: true });
    }

    logger.warn(`[MLLock] Release ignored — lock owner mismatch for execution ${execution_id}`);
    return res.status(200).json({ released: false, reason: 'owner_mismatch' });
  } catch (err) {
    logger.error(`[MLLock] Error releasing lock: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/internal/training-readiness
 * Verifies if sufficient new production data (>= 100 completed orders) exists for ML retraining.
 */
router.get('/internal/training-readiness', requireApiKey, async (req, res) => {
  try {
    let completedOrderCount = 0;
    if (supabaseAdmin) {
      const { count, error } = await supabaseAdmin
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed');

      if (!error && typeof count === 'number') {
        completedOrderCount = count;
      }
    }

    let telemetryCount = 0;
    if (mongoDb) {
      try {
        telemetryCount = await mongoDb.collection('telemetry').countDocuments();
      } catch (mErr) {
        logger.warn(`[MLReadiness] Mongo count error: ${mErr.message}`);
      }
    }

    const MIN_REQUIRED_ORDERS = 100;
    const ready = completedOrderCount >= MIN_REQUIRED_ORDERS;

    return res.status(200).json({
      ready,
      completedOrdersCount: completedOrderCount,
      minOrdersRequired: MIN_REQUIRED_ORDERS,
      telemetryRecordsCount: telemetryCount,
      reason: ready ? null : 'insufficient_completed_orders',
      message: ready
        ? 'Sufficient completed orders accumulated for retraining.'
        : `Insufficient completed orders (${completedOrderCount} < ${MIN_REQUIRED_ORDERS}). Retraining skipped.`,
    });
  } catch (err) {
    logger.error(`[MLReadiness] Error checking training readiness: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
