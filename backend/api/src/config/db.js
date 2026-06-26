import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import * as admin from 'firebase-admin';
import path from 'path';
import logger from '../middleware/logger.js';

// Load environment variables from root directory .env
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

// ============================================================================
// 1. SUPABASE CLIENTS — anon key for public access (RLS enforced),
//    service role key for admin operations only (bypasses RLS)
// ============================================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export let supabase = null;
export let supabaseAdmin = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
    logger.info('Supabase client initialized successfully (anon key).');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Supabase client');
  }
} else {
  logger.warn('SUPABASE_URL or keys not found in .env. Supabase integration disabled.');
}

if (supabaseUrl && supabaseServiceKey && supabaseServiceKey !== supabaseKey) {
  try {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
    logger.info('Supabase admin client initialized successfully (service role key).');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Supabase admin client');
  }
}

// ============================================================================
// 2. MONGODB ATLAS CLIENT (Telemetry & Activity Pings)
// ============================================================================
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME || 'truxify_telemetry';

export let mongoDb = null;
let mongoClient = null;
let _mongoDbResolve = null;
const _mongoDbReady = new Promise((resolve) => { _mongoDbResolve = resolve; });

export async function waitForMongoDb() {
  await _mongoDbReady;
}

if (mongoUri) {
  try {
    mongoClient = new MongoClient(mongoUri);
    mongoClient.connect()
      .then(() => {
        mongoDb = mongoClient.db(mongoDbName);
        logger.info({ db: mongoDbName }, 'Connected to MongoDB');
        
        // Create indexes on telemetry collection
        mongoDb.collection('telemetry').createIndex(
          { timestamp: 1 },
          { expireAfterSeconds: 604800 }
        ).catch(err => logger.error({ err }, 'Failed to create TTL index on telemetry'));
        
        mongoDb.collection('telemetry').createIndex(
          { location: '2dsphere' }
        ).catch(err => logger.error({ err }, 'Failed to create 2dsphere index on telemetry'));
        if (_mongoDbResolve) _mongoDbResolve();
      })
      .catch(err => {
        logger.error({ err }, 'Failed to connect to MongoDB server');
        if (_mongoDbResolve) _mongoDbResolve();
      });
  } catch (error) {
    logger.error({ err: error }, 'MongoDB client initialization error');
    if (_mongoDbResolve) _mongoDbResolve();
  }
} else {
  if (_mongoDbResolve) _mongoDbResolve();
  logger.warn('MONGODB_URI not found in .env. MongoDB telemetry database disabled.');
}

// ============================================================================
// 3. UPSTASH REDIS CLIENT (Sessions, cache, rate limits)
// ============================================================================
const redisUrl = process.env.REDIS_URL;
export let redisClient = null;

if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
      }
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Upstash Redis server.');
    });

    redisClient.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });
  } catch (error) {
    logger.error({ err: error }, 'Redis initialization error');
  }
} else {
  logger.warn('REDIS_URL not found in .env. Redis session cache disabled.');
}
// ============================================================================
// 4. FIREBASE ADMIN SDK (SAFE OPTIONAL INIT)
// ============================================================================

export let firebaseAdmin = null;

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (serviceAccountRaw) {
  try {
    let serviceAccount = null;

    // Only try JSON parse if it looks valid
    if (serviceAccountRaw.trim().startsWith('{')) {
      serviceAccount = JSON.parse(serviceAccountRaw);
    }

    if (serviceAccount && serviceAccount.private_key) {
      // Fix escaped newlines
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

      if (!admin.apps.length) {
        firebaseAdmin = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });

        logger.info('Firebase Admin SDK initialized successfully.');
      }
    } else {
      throw new Error('Invalid Firebase service account format');
    }

  } catch (err) {
    logger.warn({ err }, 'Firebase disabled (invalid config). Continuing without it.');
    firebaseAdmin = null;
  }
} else {
  logger.warn('Firebase not configured. Skipping initialization.');
}

export async function closeDbConnections() {
  if (mongoClient) {
    try {
      await mongoClient.close();
      mongoClient = null;
      mongoDb = null;
      logger.info('[shutdown] MongoDB connection closed.');
    } catch (err) {
      logger.error({ err }, '[shutdown] MongoDB close error');
    }
  }

  if (redisClient) {
    try {
      if (redisClient.status !== 'end') {
        await redisClient.quit();
      }
      logger.info('[shutdown] Redis connection closed.');
    } catch (err) {
      logger.error({ err }, '[shutdown] Redis quit error');
      try {
        redisClient.disconnect();
      } catch (disconnectErr) {
        logger.error({ err: disconnectErr }, '[shutdown] Redis disconnect error');
      }
    } finally {
      redisClient = null;
    }
  }
}

/**
 * Validates that all required environment variables are present for production.
 * Logs warnings for missing optional vars, throws for missing required vars.
 */
export function validateConfig() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const recommended = ['REDIS_URL', 'MONGODB_URI', 'FIREBASE_SERVICE_ACCOUNT_JSON'];
  const missing = required.filter((key) => !process.env[key]);
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    const msg = `Missing required env vars: ${missing.join(', ')}`;
    logger.error(msg);
    throw new Error(msg);
  }

  if (missingRecommended.length > 0) {
    logger.warn(`Missing optional env vars (features disabled): ${missingRecommended.join(', ')}`);
  }

  logger.info('Config validation passed');
}
