import express from 'express';
import { supabase, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const CACHE_TTL_SEC = 3600; // 1 hour for L2 Redis
const L1_TTL_MS = 300 * 1000; // 5 minutes for L1 Memory Cache
const MAX_L1_KEYS = 1000; // LRU cap

const l1Cache = new Map();
const inflight = new Map();

function setL1(key, data, expiresAt) {
  if (l1Cache.has(key)) {
    l1Cache.delete(key); // Refresh key position
  } else if (l1Cache.size >= MAX_L1_KEYS) {
    const firstKey = l1Cache.keys().next().value;
    l1Cache.delete(firstKey); // LRU eviction
  }
  l1Cache.set(key, { data, expiresAt });
}

async function getCachedOrFetch(key, fetchFn) {
  const existing = inflight.get(key);
  if (existing) return existing;

  const fetchPromise = (async () => {
    const now = Date.now();

    // 1. Check L1 Memory Cache
    const l1Entry = l1Cache.get(key);
    if (l1Entry) {
      if (now < l1Entry.expiresAt) {
        return l1Entry.data;
      }
      l1Cache.delete(key);
    }

    // 2. Check L2 Redis Cache
    if (redisClient) {
      try {
        const cached = await redisClient.get(key);
        if (cached) {
          try {
            const data = JSON.parse(cached);
            if (data !== null) {
              setL1(key, data, now + L1_TTL_MS);
              return data;
            }
          } catch {
            // fall through to fetch on malformed cached payload
          }
        }
      } catch (err) {
        logger.error({ err, key }, 'Redis cache get error');
      }
    }

    // 3. Cache Miss - Fetch from Database
    const data = await fetchFn();

    if (data) {
      // Populate L1 Cache
      setL1(key, data, now + L1_TTL_MS);

      // Populate L2 Cache
      if (redisClient) {
        try {
          await redisClient.set(key, JSON.stringify(data), 'EX', CACHE_TTL_SEC);
        } catch (err) {
          logger.error({ err, key }, 'Redis cache set error');
        }
      }
    }

    return data;
  })();

  // Atomic check-and-set: only first caller wins
  const actual = inflight.get(key) || inflight.set(key, fetchPromise).get(key);
  try {
    return await actual;
  } finally {
    inflight.delete(key);
  }
}

router.get('/vehicle-types', async (req, res) => {
  try {
    const data = await getCachedOrFetch('lookup:vehicle_types', async () => {
      const { data, error } = await supabase.from('vehicle_types').select('*');
      if (error) throw error;
      return data || [];
    });
    res.json({ data });
  } catch (error) {
    logger.error({ error }, 'Error fetching vehicle types');
    res.status(500).json({ error: 'Failed to fetch vehicle types' });
  }
});

router.get('/regions', async (req, res) => {
  try {
    const data = await getCachedOrFetch('lookup:regions', async () => {
      const { data, error } = await supabase.from('regions').select('*');
      if (error) throw error;
      return data || [];
    });
    res.json({ data });
  } catch (error) {
    logger.error({ error }, 'Error fetching regions');
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

export default router;
