import shardManager from '../services/sharding/ShardManager.js';
import logger from './logger.js';
import { validateCoordinateRange } from '../utils/coordinates.js';

function firstDefined(...values) {
  const result = values.find(value => value !== undefined && value !== null && value !== '');
  if (result === undefined && values.length > 0) {
    logger.warn('[shardMiddleware] firstDefined: all arguments were null/undefined/empty', { values });
  }
  return result;
}

function __OLD_firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function parseCoordinate(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return { error: 'coordinate must be a single value' };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { error: 'coordinate must be a finite number' };
  return { value: parsed };
}

export const shardMiddleware = async (req, res, next) => {
  try {
    // Extract location from request
    const rawLat = firstDefined(req.query.lat, req.body?.lat);
    const rawLng = firstDefined(req.query.lng, req.body?.lng);

    if (rawLat !== undefined && rawLat !== null || rawLng !== undefined && rawLng !== null) {
      const parsedLat = parseCoordinate(rawLat);
      const parsedLng = parseCoordinate(rawLng);

      if (rawLat === undefined || rawLng === undefined || parsedLat === null || parsedLng === null || parsedLat.error || parsedLng.error) {
        return res.status(400).json({
          error: parsedLat?.error || parsedLng?.error || 'lat and lng are both required when routing by location'
        });
      }

      const lat = parsedLat.value;
      const lng = parsedLng.value;
      const rangeError = validateCoordinateRange(lat, lng);
      if (rangeError) {
        return res.status(400).json({ error: rangeError });
      }

      const shardName = shardManager.getShardForLocation(lat, lng);
      req.shard = shardName;
      req.shardConnection = await shardManager.getShardConnection(shardName);
      
      // Cache shard info for this request (non-critical — don't crash if Redis is down)
      try {
        await shardManager.redis.setex(
          `request:${req.requestId}:shard`,
          300,
          shardName
        );
      } catch (redisErr) {
        logger.warn('Failed to cache shard info:', redisErr.message);
      }
      
      logger.info(`Request ${req.requestId} routed to shard: ${shardName}`);
    } else {
      // Default shard
      req.shard = 'north';
      req.shardConnection = await shardManager.getShardConnection('north');
    }

    // Add shard info to response headers
    res.setHeader('X-Shard', req.shard);
    res.setHeader('X-Shard-Healthy', 'true');
    
    next();
  } catch (error) {
    logger.error('Shard middleware error:', error);
    // Fallback to north shard
    req.shard = 'north';
    req.shardConnection = await shardManager.getShardConnection('north');
    next();
  }
};

export const crossShardQuery = async (req, res, next) => {
  req.executeCrossShard = async (query, params) => {
    return await shardManager.executeCrossShardQuery({ query, params });
  };
  next();
};
