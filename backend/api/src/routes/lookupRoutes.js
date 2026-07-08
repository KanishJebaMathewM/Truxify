import express from 'express';
import { supabase, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const CACHE_TTL = 3600; // 1 hour

async function getCachedOrFetch(key, fetchFn) {
  if (redisClient) {
    try {
      const cached = await redisClient.get(key);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      logger.error({ err, key }, 'Redis cache get error');
    }
  }

  const data = await fetchFn();

  if (redisClient && data) {
    try {
      await redisClient.set(key, JSON.stringify(data), 'EX', CACHE_TTL);
    } catch (err) {
      logger.error({ err, key }, 'Redis cache set error');
    }
  }

  return data;
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
