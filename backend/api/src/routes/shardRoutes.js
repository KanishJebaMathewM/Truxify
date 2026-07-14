import express from 'express';
import shardManager from '../services/sharding/ShardManager.js';
import { shardMiddleware, crossShardQuery } from '../middleware/shardMiddleware.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';

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

function validateCoordinateRange(lat, lng) {
  if (lat < -90 || lat > 90) return 'lat must be between -90 and 90';
  if (lng < -180 || lng > 180) return 'lng must be between -180 and 180';
  return null;
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
    res.status(500).json({
      success: false,
      error: error.message
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get orders from specific shard
router.get('/shards/:shardName/orders', authenticate, userLimiter, requirePolicy('shard:query-orders'), shardMiddleware, async (req, res) => {
  try {
    const { shardName } = req.params;
    const connection = await shardManager.getShardConnection(shardName);
    const [rows] = await connection.execute(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT 100'
    );
    res.json({
      success: true,
      data: rows,
      shard: shardName
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cross-shard query
router.get('/shards/all/orders', authenticate, userLimiter, requirePolicy('shard:query-orders'), crossShardQuery, async (req, res) => {
  try {
    const results = await req.executeCrossShard(
      'SELECT COUNT(*) as total FROM orders'
    );
    const total = results.reduce((sum, r) => sum + parseInt(r.data[0]?.total || 0), 0);
    res.json({
      success: true,
      data: {
        total,
        shards: results
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
