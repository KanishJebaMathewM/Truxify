import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from '../middleware/logger.js';
import { mongoDb as mongoDbClient } from '../config/db.js';

// ============================================================================
// Shared buffered telemetry persistence pipeline.
//
// Both live-broadcast servers (the Socket.IO `/driver` location server and the
// WebSocket `/ws/tracking` tracker) push GPS points here. The buffer is the
// SINGLE authoritative persistence path: records are batched and written to the
// `telemetry` MongoDB collection with `insertMany(ordered:false)`. Live
// broadcasting NEVER waits on a MongoDB round-trip — enqueue is synchronous and
// fail-open, and the flush pipeline runs on its own scheduler.
// ============================================================================

// ── Configuration ────────────────────────────────────────────────────────────
const RECOVERY_FILE_PATH =
  process.env.RECOVERY_FILE_PATH || path.join(os.tmpdir(), 'truxify-telemetry-recovery.jsonl');
const MAX_BUFFER_SIZE = parseInt(process.env.TELEMETRY_BUFFER_MAX_SIZE, 10) || 5000;
const BUFFER_FLUSH_INTERVAL_MS = parseInt(process.env.TELEMETRY_FLUSH_INTERVAL_MS, 10) || 20000;
const BATCH_SIZE = parseInt(process.env.TELEMETRY_BATCH_SIZE, 10) || 500;
const BUFFER_MONITOR_INTERVAL_MS = parseInt(process.env.TELEMETRY_BUFFER_MONITOR_INTERVAL_MS, 10) || 30000;
const BUFFER_WARN_THRESHOLD = 0.5;
const BUFFER_CRIT_THRESHOLD = 0.8;
const FLUSH_RETRY_BASE_MS = parseInt(process.env.TELEMETRY_FLUSH_RETRY_BASE_MS, 10) || 1000;
const FLUSH_RETRY_MAX_MS = parseInt(process.env.TELEMETRY_FLUSH_RETRY_MAX_MS, 10) || 60000;
const SHUTDOWN_FLUSH_TIMEOUT_MS = parseInt(process.env.TELEMETRY_SHUTDOWN_FLUSH_TIMEOUT_MS, 10) || 10000;
const SHUTDOWN_DEFAULT_WAIT_MS = 10000;

// ── State ────────────────────────────────────────────────────────────────────
// Test override (mirrors tracker.js's old `mongoDbOverride` hook). The getter
// prefers the override when it is not `undefined` so tests can force `null`.
let mongoDbOverride;
const getMongoDb = () => (mongoDbOverride !== undefined ? mongoDbOverride : mongoDbClient);

// `retryQueue` is drained first by every flush (oldest retries first). Records
// that fail with transient errors are re-prepended into the ACTIVE ring buffer
// (not this queue) so a live ping that arrived mid-flush is never reordered.
let retryQueue = [];
let flushBackoffMs = FLUSH_RETRY_BASE_MS;
let currentFlushPromise = null;
let flushMutex = false;
let isSchedulerActive = false;
let telemetryFlushTimer = null;
let telemetryMonitorTimer = null;

// Observability counters
let eventsReceived = 0;
let telemetryTotalFlushed = 0;
let telemetryTotalDropped = 0;
let telemetryRaceDropped = 0;
let telemetryOverflowDropped = 0;
let telemetryFlushRetries = 0;
let lastFlushAt = null;
let lastFlushDurationMs = null;
let lastFlushError = null;

/**
 * Synchronous bounded ring buffer.
 *
 * All operations are synchronous so that enqueueing a GPS point never yields to
 * the event loop (the broadcast path must not be blocked or delayed by
 * persistence). `push` overwrites the OLDEST record when full (controlled,
 * metered overflow); `prepend` inserts at the front and, when over capacity,
 * drops the oldest records of the batch being prepended.
 */
class TelemetryRingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this._records = [];
  }

  get size() {
    return this._records.length;
  }

  get length() {
    return this._records.length;
  }

  /**
   * Appends a single record. Returns the number of oldest records dropped due
   * to capacity (0 or 1).
   */
  push(item) {
    if (this._records.length >= this.capacity) {
      this._records.shift();
      this._records.push(item);
      return 1;
    }
    this._records.push(item);
    return 0;
  }

  /**
   * Inserts a batch at the FRONT (oldest-first). When the batch would exceed
   * capacity, the oldest records of the batch are dropped. Returns the number
   * dropped.
   */
  prepend(items) {
    if (!items || items.length === 0) return 0;
    const available = this.capacity - this._records.length;
    const toInsert = items.length > available ? items.slice(items.length - available) : items;
    const dropped = items.length - toInsert.length;
    this._records.unshift(...toInsert);
    return dropped;
  }

  /** Synchronous snapshot (was async in the old tracker buffer). */
  toArray() {
    return [...this._records];
  }

  clear() {
    this._records = [];
  }
}

const buffer = new TelemetryRingBuffer(MAX_BUFFER_SIZE);

// ── Enqueue (live broadcast path) ────────────────────────────────────────────
/**
 * Adds one telemetry record to the pipeline. Synchronous and never throws, so
 * the caller's broadcast can proceed immediately regardless of MongoDB state.
 * Returns the number of records dropped by the overflow policy (0 normally).
 */
function enqueue(record) {
  eventsReceived++;
  let dropped;
  try {
    dropped = buffer.push(record);
  } catch (err) {
    logger.error('[TRUXIFY BUFFER] Unexpected enqueue error:', err.message);
    return 0;
  }

  if (dropped > 0) {
    telemetryTotalDropped += dropped;
    telemetryOverflowDropped += dropped;
    logger.warn(
      `[TRUXIFY BUFFER DROP] Dropped ${dropped} oldest record(s) due to capacity (${buffer.length}/${MAX_BUFFER_SIZE}).`
    );
  }

  // Batch-size trigger: opportunistically flush (fire-and-forget) once a full
  // batch is buffered so we do not wait for the interval tick at high volume.
  if (buffer.length >= BATCH_SIZE) {
    void flush();
  }

  return dropped;
}

// ── Flush pipeline ────────────────────────────────────────────────────────────
/**
 * Drains the pending records and writes them to the `telemetry` collection.
 *
 * - Coalesces concurrent callers: while a flush is in flight the same promise
 *   is returned, so a scheduler tick and a batch-size trigger never double-write.
 * - Retains everything in memory when MongoDB is unavailable (never drops on
 *   the happy path).
 * - Transient errors: all failed records are prepended back into the active
 *   buffer (oldest retries first) and the next flush backs off exponentially.
 * - Validation errors (code 121 / BulkWriteError): the offending documents are
 *   dropped permanently with a metric + log. Retrying them would loop forever.
 */
function flush() {
  // Not async: an async function would wrap the in-flight promise in a fresh
  // outer promise on every call, so concurrent callers would NOT receive the
  // same reference. Returning `currentFlushPromise` directly (or `undefined`)
  // keeps the coalescing contract exact for `void flush()` and `await flush()`.
  if (currentFlushPromise) {
    return currentFlushPromise;
  }

  if (buffer.length === 0 && retryQueue.length === 0) {
    flushBackoffMs = FLUSH_RETRY_BASE_MS;
    return undefined;
  }

  if (!getMongoDb()) {
    logger.error('[TRUXIFY STORAGE WARN] MongoDB is not initialized or disconnected. Retaining telemetry logs in memory buffer.');
    return undefined;
  }

  if (flushMutex) return undefined;
  flushMutex = true;

  // Atomic swap: take everything pending (retry queue first, then the active
  // buffer) and reset both. Any ping that arrives while the insert is in
  // flight lands in the fresh active buffer, and on failure the taken records
  // are prepended back so the oldest data retries first.
  const recordsToFlush = retryQueue.length > 0
    ? [...retryQueue, ...buffer.toArray()]
    : buffer.toArray();
  retryQueue = [];
  buffer.clear();

  if (recordsToFlush.length === 0) {
    flushMutex = false;
    return undefined;
  }

  const flushStartedAt = Date.now();
  currentFlushPromise = (async () => {
    logger.info(`[TRUXIFY BATCH CONTROL] Committing bulk cluster of ${recordsToFlush.length} spatial rows to MongoDB...`);
    try {
      const collection = getMongoDb().collection('telemetry');
      await collection.insertMany(recordsToFlush, { ordered: false });
      telemetryTotalFlushed += recordsToFlush.length;
      logger.info(`[TRUXIFY DB SUCCESS] Successfully flushed ${recordsToFlush.length} records to MongoDB telemetry collection. Total flushed: ${telemetryTotalFlushed}`);
      flushBackoffMs = FLUSH_RETRY_BASE_MS;
      lastFlushError = null;
    } catch (err) {
      const isBulkWriteError =
        err.code === 121 ||
        err.name === 'BulkWriteError' ||
        (err.message && err.message.includes('Document failed validation'));

      if (isBulkWriteError) {
        // Permanent failure — retrying the offending documents can never
        // succeed, so drop them and report instead of looping forever.
        const failedIndices = err.writeErrors
          ? new Set(err.writeErrors.map((e) => e.index))
          : null;

        if (failedIndices) {
          const sampleErrors = err.writeErrors.slice(0, 5).map((e) =>
            `doc ${e.index}: ${e.err?.message || 'unknown'}`
          ).join('; ');
          logger.error(`[TRUXIFY VALIDATION] ${err.writeErrors.length} documents failed validation. Samples: ${sampleErrors}`);

          const failed = recordsToFlush.filter((_, i) => failedIndices.has(i));
          if (failed.length > 0) {
            telemetryTotalDropped += failed.length;
            telemetryOverflowDropped += failed.length;
            logger.warn(`[TRUXIFY VALIDATION DROP] Dropped ${failed.length} permanently-invalid telemetry records.`);
          }
          // With ordered:false the remaining documents WERE inserted — count
          // them so the metrics reflect reality and never double-write them.
          telemetryTotalFlushed += recordsToFlush.length - failed.length;
        } else {
          logger.error(`[TRUXIFY VALIDATION] Bulk insert validation error: ${err.message}`);
          telemetryTotalDropped += recordsToFlush.length;
          telemetryOverflowDropped += recordsToFlush.length;
          logger.warn(`[TRUXIFY VALIDATION DROP] Dropped ${recordsToFlush.length} permanently-invalid telemetry records.`);
        }
      } else {
        // Transient — back off and retry the whole batch (oldest first).
        flushBackoffMs = Math.min(flushBackoffMs * 2, FLUSH_RETRY_MAX_MS);
        telemetryFlushRetries++;
        lastFlushError = err.message;
        const overflowDrop = buffer.prepend(recordsToFlush);
        if (overflowDrop > 0) {
          telemetryTotalDropped += overflowDrop;
          telemetryOverflowDropped += overflowDrop;
          logger.warn(`[TRUXIFY BUFFER DROP] Dropped ${overflowDrop} oldest records due to capacity after flush failure.`);
        }
      }
    } finally {
      lastFlushDurationMs = Date.now() - flushStartedAt;
      lastFlushAt = new Date().toISOString();
      currentFlushPromise = null;
      flushMutex = false;
    }
  })();

  return currentFlushPromise;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function scheduleNextFlush() {
  if (!isSchedulerActive) return;
  telemetryFlushTimer = setTimeout(async () => {
    try {
      await flush();
    } finally {
      scheduleNextFlush();
    }
  }, Math.max(BUFFER_FLUSH_INTERVAL_MS, flushBackoffMs));
}

function monitorBufferSize() {
  const totalLen = buffer.length + retryQueue.length;
  const usagePct = totalLen / MAX_BUFFER_SIZE;
  if (usagePct >= BUFFER_CRIT_THRESHOLD) {
    logger.warn(
      `[TRUXIFY BUFFER MONITOR] CRITICAL: Buffer at ${(usagePct * 100).toFixed(0)}% ` +
      `(${totalLen}/${MAX_BUFFER_SIZE}) [active=${buffer.length} flush=${retryQueue.length}] ` +
      `flushed=${telemetryTotalFlushed} dropped=${telemetryTotalDropped}`
    );
  } else if (usagePct >= BUFFER_WARN_THRESHOLD) {
    logger.warn(
      `[TRUXIFY BUFFER MONITOR] WARNING: Buffer at ${(usagePct * 100).toFixed(0)}% ` +
      `(${totalLen}/${MAX_BUFFER_SIZE}) [active=${buffer.length} flush=${retryQueue.length}] ` +
      `flushed=${telemetryTotalFlushed} dropped=${telemetryTotalDropped}`
    );
  }
}

async function loadRecoveryFile() {
  try {
    if (fs.existsSync(RECOVERY_FILE_PATH)) {
      const content = fs.readFileSync(RECOVERY_FILE_PATH, 'utf-8').trim();
      if (content) {
        const records = content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
        if (records.length > 0) {
          buffer.prepend(records);
          logger.info(`[TRUXIFY RECOVERY] Loaded ${records.length} telemetry records from recovery file. Buffer size: ${buffer.length}`);
        }
      }
      fs.unlinkSync(RECOVERY_FILE_PATH);
    }
  } catch (err) {
    logger.error('[TRUXIFY RECOVERY] Failed to load recovery file:', err.message);
    try { fs.unlinkSync(RECOVERY_FILE_PATH); } catch (_) { /* ignore */ }
  }
}

/** Starts the flush scheduler + buffer monitor. Idempotent. */
function start() {
  if (isSchedulerActive) return;
  isSchedulerActive = true;
  void loadRecoveryFile();
  scheduleNextFlush();
  telemetryMonitorTimer = setInterval(() => {
    monitorBufferSize();
  }, BUFFER_MONITOR_INTERVAL_MS);
}

// ── Shutdown ─────────────────────────────────────────────────────────────────
/**
 * Stops the scheduler, waits up to `MONGODB_SHUTDOWN_WAIT_MS` (read at call
 * time so tests can set it after import) for MongoDB, then performs a final
 * flush. When MongoDB never becomes available the pending records are written
 * to the recovery file AND retained in the buffer (never silently lost), and a
 * warning is emitted. Safe to call repeatedly.
 */
async function shutdown() {
  if (telemetryFlushTimer) {
    clearTimeout(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
  if (telemetryMonitorTimer) {
    clearInterval(telemetryMonitorTimer);
    telemetryMonitorTimer = null;
  }
  isSchedulerActive = false;

  const parsedWait = parseInt(process.env.MONGODB_SHUTDOWN_WAIT_MS, 10);
  const mongoMaxWaitMs = Number.isNaN(parsedWait) ? SHUTDOWN_DEFAULT_WAIT_MS : parsedWait;

  if (mongoMaxWaitMs > 0) {
    const mongoPollIntervalMs = Math.min(500, mongoMaxWaitMs);
    const mongoWaitStart = Date.now();
    while (!getMongoDb() && Date.now() - mongoWaitStart < mongoMaxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, mongoPollIntervalMs));
    }
    if (!getMongoDb()) {
      const allPending = [...retryQueue, ...buffer.toArray()];
      if (allPending.length > 0) {
        try {
          const lines = allPending.map((r) => JSON.stringify(r)).join('\n');
          fs.writeFileSync(RECOVERY_FILE_PATH, lines + '\n', { encoding: 'utf-8', mode: 0o600 });
          logger.warn(`[TRUXIFY SHUTDOWN] MongoDB not available. Wrote ${allPending.length} telemetry records to recovery file: ${RECOVERY_FILE_PATH}`);
        } catch (fileErr) {
          logger.error(`[TRUXIFY SHUTDOWN] Failed to write recovery file: ${fileErr.message}. ${allPending.length} records lost.`);
        }
      }
    }
  }

  // Wait for any in-flight flush to complete.
  if (currentFlushPromise) {
    try {
      await currentFlushPromise;
    } catch (err) {
      // Ignore; the final flush below retries.
    }
  }

  try {
    const finalFlush = flush();
    await Promise.race([
      finalFlush,
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    logger.error('[shutdown] Failed to flush telemetry buffer:', err.message);
  }
}

// ── Reads (last-known-position support) ──────────────────────────────────────
/**
 * Reads the most recent telemetry point for a booking (matched against either
 * the order display id or the order UUID). Returns null when MongoDB is
 * unavailable or no point exists. Used by the Socket.IO location server to
 * replay a "last known position" to a newly subscribed customer.
 */
async function readLatestPoint(bookingId) {
  const db = getMongoDb();
  if (!db) return null;
  try {
    const docs = await db
      .collection('telemetry')
      .find(
        { $or: [{ order_display_id: bookingId }, { order_id: bookingId }] },
        { sort: { timestamp: -1 }, limit: 1 }
      )
      .toArray();
    if (docs.length === 0) return null;
    const doc = docs[0];
    return {
      lat: doc.lat,
      lng: doc.lng,
      speed: doc.speed_kmh ?? 0,
      heading: doc.bearing_deg ?? 0,
      timestamp: doc.timestamp instanceof Date ? doc.timestamp : new Date(doc.timestamp),
    };
  } catch (err) {
    logger.error({ err }, '[telemetryBuffer] Failed to read latest telemetry point');
    return null;
  }
}

// ── Observability ─────────────────────────────────────────────────────────────
function getMetrics() {
  return {
    eventsReceived,
    eventsBuffered: buffer.length,
    eventsFlushed: telemetryTotalFlushed,
    eventsDropped: telemetryTotalDropped,
    overflowDropped: telemetryOverflowDropped,
    raceDropped: telemetryRaceDropped,
    retryCount: telemetryFlushRetries,
    lastFlushAt,
    lastFlushDurationMs,
    lastFlushError,
    config: {
      maxBufferSize: MAX_BUFFER_SIZE,
      flushIntervalMs: BUFFER_FLUSH_INTERVAL_MS,
      batchSize: BATCH_SIZE,
      monitorIntervalMs: BUFFER_MONITOR_INTERVAL_MS,
      retryBaseMs: FLUSH_RETRY_BASE_MS,
      retryMaxMs: FLUSH_RETRY_MAX_MS,
      shutdownFlushTimeoutMs: SHUTDOWN_FLUSH_TIMEOUT_MS,
    },
  };
}

function getState() {
  return {
    isSchedulerActive,
    isFlushing: Boolean(currentFlushPromise),
    bufferSize: buffer.length,
    retryQueueSize: retryQueue.length,
    flushBackoffMs,
  };
}

// ── Test hooks ────────────────────────────────────────────────────────────────
const _test = {
  setMongoDbOverride(val) {
    mongoDbOverride = val;
  },
  getBuffer() {
    return buffer;
  },
  getRetryQueue() {
    return retryQueue;
  },
  setRetryQueue(records) {
    retryQueue = records ?? [];
  },
  async setBuffer(records) {
    buffer.clear();
    if (records) buffer.prepend(records);
  },
  async push(records) {
    if (Array.isArray(records)) {
      for (const r of records) buffer.push(r);
    } else {
      buffer.push(records);
    }
  },
  async clearBuffer() {
    buffer.clear();
  },
  flush,
  start,
  shutdown,
  reset() {
    buffer.clear();
    retryQueue = [];
    flushBackoffMs = FLUSH_RETRY_BASE_MS;
    currentFlushPromise = null;
    flushMutex = false;
    isSchedulerActive = false;
    if (telemetryFlushTimer) {
      clearTimeout(telemetryFlushTimer);
      telemetryFlushTimer = null;
    }
    if (telemetryMonitorTimer) {
      clearInterval(telemetryMonitorTimer);
      telemetryMonitorTimer = null;
    }
    eventsReceived = 0;
    telemetryTotalFlushed = 0;
    telemetryTotalDropped = 0;
    telemetryRaceDropped = 0;
    telemetryOverflowDropped = 0;
    telemetryFlushRetries = 0;
    lastFlushAt = null;
    lastFlushDurationMs = null;
    lastFlushError = null;
  },
  getMetrics,
  getState,
};

export default {
  enqueue,
  flush,
  start,
  shutdown,
  readLatestPoint,
  getMetrics,
  getState,
  getBuffer: () => buffer,
  _test,
};
