import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
const SHUTDOWN_FLUSH_TIMEOUT_MS = boundedShutdownMs(process.env.TELEMETRY_SHUTDOWN_FLUSH_TIMEOUT_MS, 10000);
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
let inFlightRecords = [];
let shutdownPromise = null;
let shutdownStarted = false;
let shutdownCompleted = false;

// Shutdown is terminal for this module instance. Bounds prevent invalid timer
// values from turning the drain into an indefinite wait or immediate overflow.
function boundedShutdownMs(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 30000
    ? parsed : fallback;
}
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
  if (shutdownCompleted) {
    // Producers must be stopped by the caller before shutdown. Late arrivals
    // are explicitly metered instead of creating uncheckpointed pending work.
    telemetryTotalDropped++;
    logger.warn('[TRUXIFY SHUTDOWN] Dropped telemetry received after shutdown completed.');
    return 1;
  }
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
  if (!shutdownStarted && buffer.length >= BATCH_SIZE) {
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
  if (shutdownStarted) return currentFlushPromise ?? undefined;
  return flushOwned();
}

// Only the shutdown drain may start another write after the scheduler stops.
function flushOwned() {
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

  inFlightRecords = recordsToFlush;
  const flushStartedAt = Date.now();
  currentFlushPromise = (async () => {
    logger.info(`[TRUXIFY BATCH CONTROL] Committing bulk cluster of ${recordsToFlush.length} spatial rows to MongoDB...`);
    try {
      await Promise.resolve().then(() => getMongoDb().collection('telemetry').insertMany(recordsToFlush, { ordered: false }));
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
      inFlightRecords = [];
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
        // Parse line-by-line and skip corrupt records instead of failing the
        // whole batch. A single malformed line used to throw out of this map,
        // hit the outer catch, and delete the recovery file — losing every
        // other (valid) record the file existed to preserve.
        let skipped = 0;
        const records = content
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch (parseErr) {
              skipped++;
              logger.warn(`[TRUXIFY RECOVERY] Skipping malformed telemetry record: ${parseErr.message}`);
              return [];
            }
          });
        if (skipped > 0) {
          logger.warn(`[TRUXIFY RECOVERY] Skipped ${skipped} malformed telemetry record(s).`);
        }
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
  if (isSchedulerActive || shutdownStarted) return;
  isSchedulerActive = true;
  void loadRecoveryFile();
  scheduleNextFlush();
  telemetryMonitorTimer = setInterval(() => {
    monitorBufferSize();
  }, BUFFER_MONITOR_INTERVAL_MS);
}

// ── Shutdown ─────────────────────────────────────────────────────────────────
/**
 * Terminal, coalesced shutdown. A single monotonic budget covers Mongo readiness
 * and every owned write. At expiry, checkpoint owned + queued records and return;
 * late driver settlement never deletes that checkpoint. Recovery is at-least-once
 * (an uncertain write may have committed), not Mongo cancellation or rollback.
 */
function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownStarted = true;
  if (telemetryFlushTimer) clearTimeout(telemetryFlushTimer);
  if (telemetryMonitorTimer) clearInterval(telemetryMonitorTimer);
  telemetryFlushTimer = null;
  telemetryMonitorTimer = null;
  isSchedulerActive = false;
  // Defer execution so even a synchronous failure cannot race the assignment.
  shutdownPromise = Promise.resolve().then(drainForShutdown);
  return shutdownPromise;
}

async function waitWithinDeadline(work, deadline) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) return false;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(work).then(() => true, () => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), remaining); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function checkpointPending() {
  const pending = [...inFlightRecords, ...retryQueue, ...buffer.toArray()];
  if (pending.length === 0) return;
  const tempPath = `${RECOVERY_FILE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  try {
    // Synchronous capture/replace cannot interleave with flush settlement or
    // enqueue. Rename preserves the last complete snapshot on write failure.
    const lines = pending.map((record) => JSON.stringify(record)).join('\n');
    fs.writeFileSync(tempPath, lines + '\n', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, RECOVERY_FILE_PATH);
    logger.warn(`[TRUXIFY SHUTDOWN] Checkpointed ${pending.length} pending telemetry records to ${RECOVERY_FILE_PATH}`);
  } catch (err) {
    logger.error(`[TRUXIFY SHUTDOWN] Recovery checkpoint failed: ${err.message}. ${pending.length} records remain in memory.`);
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) { /* renamed or not created */ }
  }
}

async function drainForShutdown() {
  const mongoWaitMs = boundedShutdownMs(process.env.MONGODB_SHUTDOWN_WAIT_MS, SHUTDOWN_DEFAULT_WAIT_MS);
  const startedAt = performance.now();
  const mongoDeadline = startedAt + mongoWaitMs;
  const deadline = mongoDeadline + SHUTDOWN_FLUSH_TIMEOUT_MS;
  try {
    // An existing write owns its batch even if Mongo becomes unavailable.
    if (currentFlushPromise && !await waitWithinDeadline(currentFlushPromise, deadline)) return;
    while (!getMongoDb() && performance.now() < mongoDeadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, mongoDeadline - performance.now()))));
    }
    if (!getMongoDb() || performance.now() >= deadline) return;
    // Final writes share the remaining budget. A failed flush requeues records;
    // do not spin on immediate failures or start overlapping driver operations.
    while (buffer.length + retryQueue.length > 0 && performance.now() < deadline) {
      const retriesBefore = telemetryFlushRetries;
      const work = flushOwned();
      if (!work || !await waitWithinDeadline(work, deadline)) break;
      if (telemetryFlushRetries > retriesBefore) break;
    }
  } catch (err) {
    logger.error('[shutdown] Failed to drain telemetry buffer:', err.message);
  } finally {
    checkpointPending();
    shutdownCompleted = true;
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
    inFlightSize: inFlightRecords.length,
    shutdownStarted,
    shutdownCompleted,
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
    inFlightRecords = [];
    shutdownPromise = null;
    shutdownStarted = false;
    shutdownCompleted = false;
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
