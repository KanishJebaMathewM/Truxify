import express from 'express';
import logger from '../middleware/logger.js';
import shardManager from '../services/sharding/ShardManager.js';
import { shardMiddleware, crossShardQuery } from '../middleware/shardMiddleware.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateCoordinateRange } from '../utils/coordinates.js';

const router = express.Router();

function parseCoordinate(value, field) {
  if (value === undefined || value === null || value === '') {
    return { error: `${field} required` };
  }
  if (Array.isArray(value)) {
    return { error: `${field} must be a single value` };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { error: `${field} must be a finite number` };
  }
  return { value: parsed };
}

// Get shard status
router.get('/shards/status', authenticate, userLimiter, requirePolicy('shard:view'), async (req, res) => {
  try {
    const status = await shardManager.healthCheck();
    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ requestId: req.requestId }, '[ShardRoutes] Error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

// Get shard for location
router.get('/shards/location', authenticate, userLimiter, requirePolicy('shard:view'), async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const parsedLat = parseCoordinate(lat, 'lat');
    const parsedLng = parseCoordinate(lng, 'lng');

    if (parsedLat.error || parsedLng.error) {
      return res.status(400).json({
        success: false,
        error: parsedLat.error || parsedLng.error
      });
    }
    const rangeError = validateCoordinateRange(parsedLat.value, parsedLng.value);
    if (rangeError) {
      return res.status(400).json({
        success: false,
        error: rangeError
      });
    }

    const shardName = shardManager.getShardForLocation(
      parsedLat.value,
      parsedLng.value
    );
    res.json({
      success: true,
      data: {
        shard: shardName,
        lat: parsedLat.value,
        lng: parsedLng.value
      }
    });
  } catch (error) {
    logger.error({ requestId: req.requestId }, '[ShardRoutes] Error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

// Cross-shard query (registered before /shards/:shardName/orders so "all" is not captured as a shard name)
router.get('/shards/all/orders', authenticate, userLimiter, requirePolicy('shard:query-orders'), crossShardQuery, async (req, res) => {
  try {
    const crossShardRes = await req.executeCrossShard(
      'SELECT COUNT(*) as total FROM orders'
    );

    const isObject = crossShardRes && typeof crossShardRes === 'object' && !Array.isArray(crossShardRes);
    const results = isObject ? (crossShardRes.results || []) : (crossShardRes || []);
    const failedShards = isObject && Array.isArray(crossShardRes.failed) ? crossShardRes.failed : [];
    const healthyShards = isObject && Array.isArray(crossShardRes.healthy)
      ? crossShardRes.healthy
      : results.map((r) => r.shard);
    const unhealthyShards = isObject && Array.isArray(crossShardRes.unhealthy)
      ? crossShardRes.unhealthy
      : failedShards;
    const isPartial = isObject
      ? (crossShardRes.partial ?? (failedShards.length > 0))
      : (failedShards.length > 0);

    // If all shards failed completely: 503 Service Unavailable
    if (failedShards.length > 0 && healthyShards.length === 0) {
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        success: false,
        error: 'All database shards are unavailable',
        data: {
          total: 0,
          shards: [],
          failedShards,
          healthy: [],
          unhealthy: unhealthyShards,
          partial: true,
        },
      });
    }

    const total = results.reduce((sum, r) => sum + parseInt(r.data?.[0]?.total || 0, 10), 0);

    // If partial shard failure: 207 Multi-Status
    if (isPartial || failedShards.length > 0) {
      res.setHeader('Retry-After', '30');
      return res.status(207).json({
        success: false,
        warning: 'results partially unavailable',
        data: {
          total,
          shards: results,
          failedShards,
          healthy: healthyShards,
          unhealthy: unhealthyShards,
          partial: true,
        },
      });
    }

    // Complete success: 200 OK
    res.json({
      success: true,
      data: {
        total,
        shards: results,
        healthy: healthyShards,
        unhealthy: [],
        failedShards: [],
        partial: false,
      },
    });
  } catch (error) {
    logger.error({ requestId: req.requestId }, '[ShardRoutes] Error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

// Get orders from specific shard
router.get('/shards/:shardName/orders', authenticate, userLimiter, requirePolicy('shard:query-orders'), shardMiddleware, async (req, res) => {
  try {
    const { shardName } = req.params;
    const rows = await shardManager.executeQuery(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT 100',
      [],
      shardName
    );
    res.json({
      success: true,
      data: rows,
      shard: shardName
    });
  } catch (error) {
    logger.error({ requestId: req.requestId }, '[ShardRoutes] Error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

export default router;
