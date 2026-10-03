```js
import axios from 'axios';
import crypto from 'crypto';
import { supabase, supabaseAdmin } from '../config/db.js';

const voiceDb =
  (supabaseAdmin && typeof supabaseAdmin.from === 'function')
    ? supabaseAdmin
    : supabase;

import logger from '../middleware/logger.js';

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const VOICE_API_TIMEOUT_MS = 10000;
const WHISPER_TIMEOUT_MS = 15000;

export const audioCache = new Map();

function trimCache() {
  const now = Date.now();

  // 1. Collect and purge expired entries first
  const expiredKeys = [];

  for (const [key, value] of audioCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      expiredKeys.push(key);
    }
  }

  for (const key of expiredKeys) {
    audioCache.delete(key);
  }

  // 2. If capacity still exceeds MAX_CACHE_SIZE,
  // evict oldest remaining entries
  if (audioCache.size > MAX_CACHE_SIZE) {
    const oldest = [...audioCache.entries()]
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);

    const toDelete = audioCache.size - MAX_CACHE_SIZE;

    for (let i = 0; i < toDelete && i < oldest.length; i++) {
      audioCache.delete(oldest[i][0]);
    }
  }
}

function cacheAudio(id, buffer, userId) {
  audioCache.set(id, {
    buffer,
    userId,
    timestamp: Date.now()
  });

  trimCache();
}

async function getBookingContext(bookingId, userId) {
  // Guard against missing user ID
  if (!userId) {
    return null;
  }

  // Guard against null or undefined booking ID
  // Prevents uuidRegex.test() and database queries
  // from receiving a null/undefined bookingId.
  if (bookingId == null) {
    return null;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4
```
