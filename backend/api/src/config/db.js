import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createClient } from '@supabase/supabase-js';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import pg from 'pg';
import * as admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../middleware/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables relative to this module instead of process.cwd()
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ============================================================================
// 1. SUPABASE CLIENTS
// ============================================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseAnonKey) {
  logger.error('SUPABASE_ANON_KEY is not set. Supabase client will not function.');
}
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export let supabase = null;
export let supabaseAdmin = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
    logger.info('Supabase client initialized successfully (anon key — RLS enforced).');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Supabase client');
  }
} else {
  logger.warn(
    'SUPABASE_URL or SUPABASE_ANON_KEY not found in .env. Supabase integration disabled. ' +
    'Do NOT use SUPABASE_SERVICE_ROLE_KEY for the public client — it bypasses Row Level Security.'
  );
}

/**
 * Creates a per-request Supabase client authenticated with the given JWT.
 * The resulting client carries the user's identity so that
 * SECURITY DEFINER RPCs that call auth.uid() receive the correct user.
 *
 * @param {string} accessToken — a valid Supabase or Firebase access token
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createUserClient(accessToken) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Cannot create user client: SUPABASE_URL or SUPABASE_ANON_KEY is not configured.');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

if (supabaseUrl && supabaseServiceKey && supabaseServiceKey !== supabaseAnonKey) {
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
// 1.5 DIRECT POSTGRESQL POOL (PgBouncer)
// ============================================================================
const databaseUrl = process.env.DATABASE_URL;
export let pgPool = null;

if (databaseUrl) {
  try {
    const { Pool } = pg;
    pgPool = new Pool({
      connectionString: databaseUrl,
      // For PgBouncer in transaction mode, use a moderate pool size
      max: 20, 
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    logger.info('PostgreSQL Pool initialized successfully (PgBouncer port 6543).');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize PostgreSQL pool');
  }
} else {
  logger.warn('DATABASE_URL not found in .env. Direct PostgreSQL pool disabled.');
}

// ============================================================================
// 2. MONGODB ATLAS CLIENT (Telemetry & Activity Pings)
// ============================================================================
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME || 'truxify_telemetry';
const MONGO_POOL_SIZE = parseInt(process.env.MONGO_POOL_SIZE || '10', 10);
const MONGO_CONNECT_TIMEOUT = parseInt(process.env.MONGO_CONNECT_TIMEOUT || '10000', 10);
const MONGO_SERVER_SEL_TIMEOUT = parseInt(process.env.MONGO_SERVER_SEL_TIMEOUT || '5000', 10);
logger.info('[DB] MongoDB pool size: ' + MONGO_POOL_SIZE + ', connect timeout: ' + MONGO_CONNECT_TIMEOUT + 'ms');

export let mongoDb = null;
let mongoClient = null;
let _mongoDbResolve = null;
const _mongoDbReady = new Promise((resolve) => { _mongoDbResolve = resolve; });

export async function waitForMongoDb() {
  await _mongoDbReady;
}

// Wrap in async IIFE so mongoClient.connect() can use await instead of .then()
// This ensures the module properly waits for the connection before reporting readiness
(async () => {
  if (mongoUri) {
    try {
      mongoClient = new MongoClient(mongoUri);
      await mongoClient.connect();
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
    } catch (err) {
      logger.error({ err }, 'Failed to connect to MongoDB server');
      if (_mongoDbResolve) _mongoDbResolve();
    }
  } else {
    if (_mongoDbResolve) _mongoDbResolve();
    logger.warn('MONGODB_URI not found in .env. MongoDB telemetry database disabled.');
  }
})();

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
  if (supabase) {
    try {
      await supabase.removeAllChannels();
      logger.info('[shutdown] Supabase channels removed.');
    } catch (err) {
      logger.error({ err }, '[shutdown] Supabase close error');
    }
  }

  if (supabaseAdmin) {
    try {
      await supabaseAdmin.removeAllChannels();
      logger.info('[shutdown] Supabase Admin channels removed.');
    } catch (err) {
      logger.error({ err }, '[shutdown] Supabase Admin close error');
    }
  }

  if (pgPool) {
    try {
      await pgPool.end();
      logger.info('[shutdown] PostgreSQL pool closed.');
    } catch (err) {
      logger.error({ err }, '[shutdown] PostgreSQL pool close error');
    }
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      logger.info('[shutdown] Mongoose disconnected.');
    }
  } catch (err) {
    logger.error({ err }, '[shutdown] Mongoose disconnect error');
  }

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
  const recommended = ['REDIS_URL', 'MONGODB_URI', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'SUPABASE_SERVICE_ROLE_KEY'];
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

// Resolves #2050: Handle SIGINT and SIGTERM for graceful DB shutdown

async function shutdown(signal) {
  logger.info({ signal }, 'Received signal, starting graceful shutdown...');
  await closeDbConnections();
  logger.info('Graceful shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
