import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from '../../src/middleware/logger.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const RECOVERY_FILE_PATH = path.join(os.tmpdir(), 'truxify-telemetry-recovery.jsonl');

/**
 * Freshly imports the telemetryBuffer module with the given options.
 * Env vars are applied BEFORE import (the module reads them at load time).
 */
async function loadBuffer({
  maxSize,
  batchSize,
  mongo,
  mongoCollection,
} = {}) {
  vi.resetModules();
  if (maxSize === undefined) delete process.env.TELEMETRY_BUFFER_MAX_SIZE;
  else process.env.TELEMETRY_BUFFER_MAX_SIZE = String(maxSize);
  if (batchSize === undefined) delete process.env.TELEMETRY_BATCH_SIZE;
  else process.env.TELEMETRY_BATCH_SIZE = String(batchSize);

  const insertMany = vi.fn();
  const collection = vi.fn(() => ({
    insertMany,
    find: mongoCollection ? mongoCollection.find : undefined,
  }));
  const mongoDb = mongo === undefined ? { collection } : mongo;
  vi.doMock('../../src/config/db.js', () => ({ mongoDb }));

  const mod = await import('../../src/sockets/telemetryBuffer.js');
  return { buf: mod.default, insertMany, collection };
}

describe('telemetryBuffer - buffered telemetry ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONGODB_SHUTDOWN_WAIT_MS = '0';
    try { fs.unlinkSync(RECOVERY_FILE_PATH); } catch (_) { /* ignore */ }
  });

  afterEach(() => {
    process.env.MONGODB_SHUTDOWN_WAIT_MS = '0';
    delete process.env.TELEMETRY_BUFFER_MAX_SIZE;
    delete process.env.TELEMETRY_BATCH_SIZE;
    delete process.env.TELEMETRY_TTL_SECONDS;
    try { fs.unlinkSync(RECOVERY_FILE_PATH); } catch (_) { /* ignore */ }
  });

  it('CASE 1: enqueues records synchronously and flushes them via batched insertMany', async () => {
    const { buf, insertMany, collection } = await loadBuffer({});
    insertMany.mockResolvedValue({ insertedCount: 3 });

    buf.enqueue({ driver_id: 'd1', lat: 12.9, lng: 77.5 });
    buf.enqueue({ driver_id: 'd1', lat: 12.91, lng: 77.51 });
    buf.enqueue({ driver_id: 'd1', lat: 12.92, lng: 77.52 });

    // Enqueue is synchronous — the buffer reflects the records immediately.
    expect(buf.getBuffer().size).toBe(3);
    expect(buf.getBuffer().toArray()).toHaveLength(3);
    expect(buf.getMetrics().eventsReceived).toBe(3);

    await buf.flush();

    expect(collection).toHaveBeenCalledWith('telemetry');
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(3);
    expect(insertMany.mock.calls[0][1]).toEqual({ ordered: false });
    expect(buf.getBuffer().size).toBe(0);
    expect(buf.getMetrics().eventsFlushed).toBe(3);
  });

  it('CASE 2: a slow MongoDB write does not block enqueueing (broadcast independence)', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { buf, insertMany } = await loadBuffer({});
    insertMany.mockImplementation(() => gate);
    buf.getBuffer().push({ driver_id: 'd2' });

    // First flush is in-flight and unresolved.
    const inFlight = buf.flush();
    const t0 = Date.now();
    buf.enqueue({ driver_id: 'd2', lat: 1, lng: 2 });
    expect(Date.now() - t0).toBeLessThan(50);
    // The live buffer still accepts new pings while the insert is pending.
    expect(buf.getBuffer().size).toBe(1);

    release();
    await inFlight;
    expect(buf.getBuffer().size).toBe(1);
  });

  it('CASE 2b: a slow MongoDB write still yields a batched insertMany (deferred)', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { buf, insertMany } = await loadBuffer({});
    insertMany.mockImplementation(() => gate);

    buf.enqueue({ driver_id: 'd2', lat: 1, lng: 2 });
    const p = buf.flush();
    expect(buf.getBuffer().size).toBe(0); // drained for the insert
    release();
    await p;
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it('CASE 3: enqueueing a full batch triggers an opportunistic non-blocking flush', async () => {
    const { buf, insertMany } = await loadBuffer({ batchSize: 2 });
    insertMany.mockResolvedValue({ insertedCount: 2 });

    buf.enqueue({ driver_id: 'd3', lat: 1, lng: 2 });
    buf.enqueue({ driver_id: 'd3', lat: 1, lng: 3 });

    await vi.waitFor(() => expect(insertMany).toHaveBeenCalledTimes(1));
    expect(buf.getBuffer().size).toBe(0);
    expect(buf.getMetrics().eventsFlushed).toBe(2);
  });

  it('CASE 4: overflow drops the OLDEST records and emits a drop metric + log', async () => {
    const { buf } = await loadBuffer({ maxSize: 3 });
    buf.enqueue({ seq: 1 });
    buf.enqueue({ seq: 2 });
    buf.enqueue({ seq: 3 });
    const dropped = buf.enqueue({ seq: 4 });

    expect(dropped).toBe(1);
    expect(buf.getBuffer().toArray().map((r) => r.seq)).toEqual([2, 3, 4]);
    const m = buf.getMetrics();
    expect(m.eventsReceived).toBe(4);
    expect(m.eventsDropped).toBe(1);
    expect(m.overflowDropped).toBe(1);
    expect(m.eventsBuffered).toBe(3);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[TRUXIFY BUFFER DROP]'));
  });

  it('CASE 5: transient MongoDB failure retains records and retries on the next flush', async () => {
    const { buf, insertMany } = await loadBuffer({});
    insertMany
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ insertedCount: 1 });

    buf.enqueue({ driver_id: 'd5' });

    await buf.flush();
    expect(buf.getBuffer().size).toBe(1); // retained, not dropped
    expect(buf.getMetrics().retryCount).toBe(1);

    await buf.flush();
    expect(buf.getBuffer().size).toBe(0);
    expect(insertMany).toHaveBeenCalledTimes(2);
    expect(buf.getMetrics().eventsFlushed).toBe(1);
  });

  it('CASE 6: partial bulk failure drops only the invalid docs, never re-queues inserted ones', async () => {
    const bulkErr = new Error('insert failed');
    bulkErr.name = 'BulkWriteError';
    bulkErr.writeErrors = [{ index: 1, err: { message: 'Document failed validation' } }];
    const { buf, insertMany } = await loadBuffer({});
    insertMany.mockRejectedValueOnce(bulkErr);

    buf.enqueue({ seq: 'valid-a' });
    buf.enqueue({ seq: 'bad' });
    buf.enqueue({ seq: 'valid-c' });

    await buf.flush();

    // Invalid doc dropped permanently; valid docs (a + c) counted as flushed
    // and NOT re-queued (no duplicates on a future flush).
    expect(buf.getBuffer().size).toBe(0);
    const m = buf.getMetrics();
    expect(m.eventsFlushed).toBe(2);
    expect(m.eventsDropped).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[TRUXIFY VALIDATION] 1 documents failed validation')
    );
  });

  it('CASE 6b: whole-batch validation error (code 121, no writeErrors) drops everything', async () => {
    const validationError = new Error('Document failed validation');
    validationError.code = 121;
    const { buf, insertMany } = await loadBuffer({});
    insertMany.mockRejectedValue(validationError);

    buf.enqueue({ driver_id: 'd6b' });

    await buf.flush();
    expect(buf.getBuffer().size).toBe(0);
    expect(buf.getMetrics().eventsDropped).toBe(1);
  });

  it('CASE 7: the buffer does NOT de-duplicate identical points (dedup lives in the Redis sequence gate)', async () => {
    const { buf, insertMany } = await loadBuffer({});
    insertMany.mockResolvedValue({ insertedCount: 2 });

    buf.enqueue({ driver_id: 'd7', lat: 1, lng: 2 });
    buf.enqueue({ driver_id: 'd7', lat: 1, lng: 2 });

    expect(buf.getBuffer().size).toBe(2); // both retained independently
    await buf.flush();
    expect(insertMany.mock.calls[0][0]).toHaveLength(2);
  });

  it('CASE 8: db.js createTelemetryCollectionIndexes honours TELEMETRY_TTL_SECONDS', async () => {
    delete process.env.MONGODB_URI;
    process.env.TELEMETRY_TTL_SECONDS = '3600';
    vi.doUnmock('../../src/config/db.js');
    vi.resetModules();
    const dbModule = await import('../../src/config/db.js');
    try {
      expect(dbModule.getTelemetryTtlSeconds()).toBe(3600);

      const createIndex = vi.fn(() => Promise.resolve('created'));
      const collection = vi.fn(() => ({ createIndex }));
      dbModule.createTelemetryCollectionIndexes({ collection });

      await vi.waitFor(() => expect(createIndex).toHaveBeenCalledTimes(3));
      expect(collection).toHaveBeenCalledWith('telemetry');
      expect(createIndex).toHaveBeenCalledWith({ timestamp: 1 }, { expireAfterSeconds: 3600 });
      expect(createIndex).toHaveBeenCalledWith({ driver_id: 1, order_id: 1, timestamp: -1 });
      expect(createIndex).toHaveBeenCalledWith({ location: '2dsphere' });
    } finally {
      delete process.env.TELEMETRY_TTL_SECONDS;
    }
  });

  it('CASE 9: graceful shutdown performs a final flush when MongoDB is available', async () => {
    const { buf, insertMany } = await loadBuffer({});
    insertMany.mockResolvedValue({ insertedCount: 2 });

    buf.enqueue({ driver_id: 'd9' });
    buf.enqueue({ driver_id: 'd9' });

    process.env.MONGODB_SHUTDOWN_WAIT_MS = '50';
    await buf.shutdown();

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(buf.getBuffer().size).toBe(0);
    expect(buf.getMetrics().eventsFlushed).toBe(2);
  });

  it('CASE 10: shutdown with unavailable MongoDB writes the recovery file and retains records', async () => {
    const { buf } = await loadBuffer({ mongo: null });

    buf.enqueue({ driver_id: 'd10', lat: 1, lng: 2 });

    process.env.MONGODB_SHUTDOWN_WAIT_MS = '20';
    await buf.shutdown();

    // Records are NEVER silently lost during shutdown.
    expect(buf.getBuffer().size).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[TRUXIFY SHUTDOWN] MongoDB not available.')
    );
    expect(fs.existsSync(RECOVERY_FILE_PATH)).toBe(true);
    const lines = fs.readFileSync(RECOVERY_FILE_PATH, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).driver_id).toBe('d10');
  });

  it('CASE 11: concurrent flush() calls coalesce into a single in-flight insert', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { buf, insertMany } = await loadBuffer({});
    insertMany.mockImplementation(() => gate);

    buf.enqueue({ driver_id: 'd11' });

    const p1 = buf.flush();
    const p2 = buf.flush();
    expect(p2).toBe(p1); // coalesced — no double write

    release();
    await p1;
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it('CASE 12: 10,000 high-frequency enqueues stay within the configured capacity', async () => {
    const { buf } = await loadBuffer({ maxSize: 5000, batchSize: 1000000 });
    for (let i = 0; i < 10000; i += 1) {
      buf.enqueue({ seq: i });
    }
    const buffered = buf.getBuffer().toArray();
    expect(buffered).toHaveLength(5000);
    // Oldest records were dropped first — the ring holds the most recent 5000.
    expect(buffered[0].seq).toBe(5000);
    expect(buffered[4999].seq).toBe(9999);
    const m = buf.getMetrics();
    expect(m.eventsReceived).toBe(10000);
    expect(m.eventsDropped).toBe(5000);
    expect(m.eventsBuffered).toBe(5000);
  });

  it('CASE 13: regression — shutdown is safe and idempotent when nothing was ever started', async () => {
    const { buf } = await loadBuffer({ mongo: null });
    await buf.shutdown();
    await buf.shutdown(); // second call must not throw
    expect(buf.getBuffer().size).toBe(0);
  });
});
