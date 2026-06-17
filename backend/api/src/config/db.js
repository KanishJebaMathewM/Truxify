import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import * as admin from 'firebase-admin';
import path from 'path';

// Load environment variables from root directory .env
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

// ============================================================================
// 1. SUPABASE CLIENT
// ============================================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export let supabase = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
    console.log('✅ Supabase client initialized successfully.');
  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error.message);
  }
} else {
  console.warn('⚠️ SUPABASE_URL or keys not found in .env. Supabase integration disabled.');
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
        console.log(`✅ Connected to MongoDB Database: "${mongoDbName}"`);
        if (_mongoDbResolve) _mongoDbResolve();
      })
      .catch(err => {
        console.error('❌ Failed to connect to MongoDB server:', err.message);
        if (_mongoDbResolve) _mongoDbResolve();
      });
  } catch (error) {
    console.error('❌ MongoDB client initialization error:', error.message);
    if (_mongoDbResolve) _mongoDbResolve();
  }
} else {
  if (_mongoDbResolve) _mongoDbResolve();
  console.warn('⚠️ MONGODB_URI not found in .env. MongoDB telemetry database disabled.');
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
      console.log('✅ Connected to Upstash Redis server.');
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis connection error:', err.message);
    });
  } catch (error) {
    console.error('❌ Redis initialization error:', error.message);
  }
} else {
  console.warn('⚠️ REDIS_URL not found in .env. Redis session cache disabled.');
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

        console.log('✅ Firebase Admin SDK initialized successfully.');
      }
    } else {
      throw new Error('Invalid Firebase service account format');
    }

  } catch (err) {
    console.warn('⚠️ Firebase disabled (invalid config). Continuing without it.');
    firebaseAdmin = null;
  }
} else {
  console.warn('⚠️ Firebase not configured. Skipping initialization.');
}

export async function closeDbConnections() {
  if (mongoClient) {
    try {
      await mongoClient.close();
      mongoClient = null;
      mongoDb = null;
      console.log('[shutdown] MongoDB connection closed.');
    } catch (err) {
      console.error('[shutdown] MongoDB close error:', err.message);
    }
  }

  if (redisClient) {
    try {
      if (redisClient.status !== 'end') {
        await redisClient.quit();
      }
      console.log('[shutdown] Redis connection closed.');
    } catch (err) {
      console.error('[shutdown] Redis quit error:', err.message);
      try {
        redisClient.disconnect();
      } catch (disconnectErr) {
        console.error('[shutdown] Redis disconnect error:', disconnectErr.message);
      }
    } finally {
      redisClient = null;
    }
  }
}
