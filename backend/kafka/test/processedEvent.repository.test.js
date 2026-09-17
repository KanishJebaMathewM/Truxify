/**
 * Unit tests for backend/kafka/repositories/processedEvent.repository.js
 *
 * Covers the two-phase claim flow (issue #11192) and the service-role write
 * path:
 *   - a fresh (topic, event_id) claim returns true (status 'processing')
 *   - a completed event is never re-claimed
 *   - a failed event can be re-claimed so the side effect can be retried
 *   - a stale 'processing' claim can be re-claimed, a fresh one cannot
 *   - markCompleted / markFailed flip the claim status
 *   - all writes go through the service-role client (supabaseAdmin)
 *
 * Run with:  npm test -- test/processedEvent.repository.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory stand-in for the kafka_processed_events table, keyed by
// `${topic}:${eventId}`.
const records = new Map();

function recordKey(topic, eventId) {
  return `${topic}:${eventId}`;
}

function resetRecords() {
  records.clear();
}

function snapshot() {
  return Array.from(records.entries()).map(([key, value]) => {
    const [topic, event_id] = key.split(':');
    return { topic, event_id, ...value };
  });
}

let mockRedisClient = null;
const mockAcquireLock = vi.fn();
const mockRenewLock = vi.fn();
const mockReleaseLock = vi.fn();

vi.mock('../../api/src/config/db.js', () => ({
  supabaseAdmin: { from: vi.fn() },
  get redisClient() {
    return mockRedisClient;
  },
}));

vi.mock('../../api/src/lib/redisLock.js', () => ({
  acquireLock: (...args) => mockAcquireLock(...args),
  renewLock: (...args) => mockRenewLock(...args),
  releaseLock: (...args) => mockReleaseLock(...args),
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import processedEventRepository from '../repositories/processedEvent.repository.js';
import { supabaseAdmin } from '../../api/src/config/db.js';

// A thenable query-builder stand-in for the supabase-js fluent API.
// Every `.eq(...)` returns a Promise (so `await builder.eq(...).eq(...)` works
// for markCompleted/markFailed) that also carries the next chained builder
// methods, mirroring the real SDK's promise-like QueryBuilder.
function supabaseFrom() {
  const where = { topic: undefined, event_id: undefined, status: undefined, started_at: undefined, consumer_group: undefined };
  let updates = null;

  const applyUpdate = () => {
    const existing = records.get(recordKey(where.topic, where.event_id));
    if (!existing) return 0;
    if (where.status !== undefined && existing.status !== where.status) return 0;
    if (where.started_at !== undefined && existing.started_at !== where.started_at) return 0;
    records.set(recordKey(where.topic, where.event_id), { ...existing, ...updates });
    return 1;
  };

  // eqNext(column, value) records the filter and returns a thenable node that
  // can be awaited (terminal — applies any pending update, as markCompleted /
  // markFailed do) or chained with .eq/.select/.update. Application is lazy so
  // intermediate chained nodes never mutate the record before the guarded
  // status filter is applied.
  const makeEq = (column, value) => {
    if (column) where[column] = value;

    let resolved = null;
    const apply = () => {
      if (resolved === null) {
        if (updates !== null && where.topic !== undefined && where.event_id !== undefined) {
          const count = applyUpdate();
          resolved = { data: count ? [{ event_id: where.event_id }] : [], error: null };
        } else {
          resolved = { data: null, error: null };
        }
      }
      return resolved;
    };

    const node = {
      eq: (col2, value2) => makeEq(col2, value2),
      update: (nextUpdates) => {
        updates = nextUpdates;
        return { data: null, error: null };
      },
      select: () => Promise.resolve(apply()),
      maybeSingle: () => {
        const existing = records.get(recordKey(where.topic, where.event_id));
        if (existing) {
          return Promise.resolve({ data: { status: existing.status, started_at: existing.started_at }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (onFulfilled, onRejected) => Promise.resolve(apply()).then(onFulfilled, onRejected),
    };
    return node;
  };

  return {
    upsert(record) {
      return {
        select() {
          const key = recordKey(record.topic, record.event_id);
          if (records.has(key)) {
            return Promise.resolve({ data: [], error: null });
          }
          records.set(key, { status: record.status, started_at: record.started_at });
          return Promise.resolve({ data: [{ event_id: record.event_id }], error: null });
        },
      };
    },
    select() {
      return {
        eq: (col, value) => makeEq(col, value),
      };
    },
    update(nextUpdates) {
      updates = nextUpdates;
      return {
        eq: (col, value) => makeEq(col, value),
      };
    },
  };
}

describe('ProcessedEventRepository claim flow', () => {
  beforeEach(() => {
    resetRecords();
    vi.clearAllMocks();
    supabaseAdmin.from.mockImplementation(() => supabaseFrom());
  });

  it('claims a fresh event as processing', async () => {
    const claimed = await processedEventRepository.claimProcessing('payment.confirmed', 'evt-001');
    expect(claimed).toBe(true);
    expect(snapshot()).toEqual([
      { topic: 'payment.confirmed', event_id: 'evt-001', status: 'processing', started_at: expect.any(String) },
    ]);
  });

  it('returns false when the same event is already completed', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-001');
    await processedEventRepository.markCompleted('payment.confirmed', 'evt-001');

    const reClaim = await processedEventRepository.claimProcessing('payment.confirmed', 'evt-001');
    expect(reClaim).toBe(false);
  });

  it('re-claims an event whose previous handler run failed', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-002');
    await processedEventRepository.markFailed('payment.confirmed', 'evt-002');

    const reClaim = await processedEventRepository.claimProcessing('payment.confirmed', 'evt-002');
    expect(reClaim).toBe(true);
    expect(snapshot()[0].status).toBe('processing');
  });

  it('skips a fresh processing claim that is still in flight', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-003');

    const reClaim = await processedEventRepository.claimProcessing('payment.confirmed', 'evt-003');
    expect(reClaim).toBe(false);
  });

  it('re-claims a processing event whose claim is stale', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-004');

    // Force the claim to look like it started minutes ago.
    const key = recordKey('payment.confirmed', 'evt-004');
    const record = records.get(key);
    records.set(key, { ...record, started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });

    const reClaim = await processedEventRepository.claimProcessing('payment.confirmed', 'evt-004', null, {
      staleProcessingAfterMs: 5 * 60 * 1000,
    });
    expect(reClaim).toBe(true);
  });

  it('treats different topics as distinct idempotency keys', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-001');
    const otherTopic = await processedEventRepository.claimProcessing('trip.completed', 'evt-001');
    expect(otherTopic).toBe(true);
  });

  it('markCompleted flips the claim to completed', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-005');
    await processedEventRepository.markCompleted('payment.confirmed', 'evt-005');

    expect(snapshot()[0].status).toBe('completed');
    const reClaim = await processedEventRepository.claimProcessing('payment.confirmed', 'evt-005');
    expect(reClaim).toBe(false);
  });

  it('markFailed flips the claim to failed', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-006');
    await processedEventRepository.markFailed('payment.confirmed', 'evt-006');

    expect(snapshot()[0].status).toBe('failed');
  });

  it('issues all writes through the service-role client (supabaseAdmin)', async () => {
    await processedEventRepository.claimProcessing('payment.confirmed', 'evt-007');
    await processedEventRepository.markCompleted('payment.confirmed', 'evt-007');

    const tableCalls = supabaseAdmin.from.mock.calls;
    expect(tableCalls.length).toBeGreaterThan(0);
    expect(tableCalls.every(([table]) => table === 'kafka_processed_events')).toBe(true);
  });

  describe('PostgreSQL started_at fencing', () => {
    it('markCompleted rejects update if started_at was changed by another replica', async () => {
      // Replica 1 claims event
      await processedEventRepository.claimProcessing('payment.confirmed', 'evt-fence-1');
      const originalStartedAt = records.get(recordKey('payment.confirmed', 'evt-fence-1')).started_at;

      // Simulate Replica 2 reclaiming after stale timeout with a new started_at
      const newStartedAt = new Date(Date.now() + 1000).toISOString();
      records.set(recordKey('payment.confirmed', 'evt-fence-1'), {
        status: 'processing',
        started_at: newStartedAt,
      });

      // Replica 1 attempts to mark completed with its original started_at
      const result = await processedEventRepository.markCompleted('payment.confirmed', 'evt-fence-1', null, {
        startedAt: originalStartedAt,
      });

      expect(result).toBe(false);
      // Status in DB remains 'processing' with Replica 2's started_at
      const current = records.get(recordKey('payment.confirmed', 'evt-fence-1'));
      expect(current.status).toBe('processing');
      expect(current.started_at).toBe(newStartedAt);
    });

    it('markFailed rejects update if started_at was changed by another replica', async () => {
      await processedEventRepository.claimProcessing('payment.confirmed', 'evt-fence-2');
      const originalStartedAt = records.get(recordKey('payment.confirmed', 'evt-fence-2')).started_at;

      // Replica 2 reclaimed it
      const newStartedAt = new Date(Date.now() + 1000).toISOString();
      records.set(recordKey('payment.confirmed', 'evt-fence-2'), {
        status: 'processing',
        started_at: newStartedAt,
      });

      const result = await processedEventRepository.markFailed('payment.confirmed', 'evt-fence-2', null, {
        startedAt: originalStartedAt,
      });

      expect(result).toBe(false);
      expect(records.get(recordKey('payment.confirmed', 'evt-fence-2')).status).toBe('processing');
    });
  });

  describe('Redis distributed locking & heartbeat renewal', () => {
    beforeEach(() => {
      mockRedisClient = { set: vi.fn(), eval: vi.fn() };
      mockAcquireLock.mockReset();
      mockRenewLock.mockReset();
      mockReleaseLock.mockReset();
      vi.useFakeTimers();
    });

    afterEach(() => {
      mockRedisClient = null;
      vi.useRealTimers();
    });

    it('skips claim when Redis lock is held by another replica', async () => {
      mockAcquireLock.mockResolvedValueOnce(null); // Lock held by another process

      const claimed = await processedEventRepository.claimProcessing(
        'payment.confirmed',
        'evt-redis-1',
        null,
        'order-service'
      );

      expect(claimed).toBe(false);
      expect(mockAcquireLock).toHaveBeenCalledWith('kafka:claim:order-service:payment.confirmed:evt-redis-1', 30_000);
      // DB upsert should NOT even happen if lock cannot be acquired
      expect(records.has(recordKey('payment.confirmed', 'evt-redis-1'))).toBe(false);
    });

    it('acquires Redis lock, starts heartbeat renewal timer, and releases lock on markCompleted', async () => {
      mockAcquireLock.mockResolvedValueOnce('token-uuid-123');
      mockRenewLock.mockResolvedValue(true);
      mockReleaseLock.mockResolvedValue(true);

      const claimed = await processedEventRepository.claimProcessing(
        'payment.confirmed',
        'evt-redis-2',
        null,
        'order-service'
      );

      expect(claimed).toBe(true);
      expect(mockAcquireLock).toHaveBeenCalledWith('kafka:claim:order-service:payment.confirmed:evt-redis-2', 30_000);
      expect(processedEventRepository.isClaimActive('payment.confirmed', 'evt-redis-2', 'order-service')).toBe(true);

      // Advance timers by 10s (first heartbeat tick)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRenewLock).toHaveBeenCalledWith('kafka:claim:order-service:payment.confirmed:evt-redis-2', 'token-uuid-123', 30_000);

      // Advance another 10s (second heartbeat tick)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRenewLock).toHaveBeenCalledTimes(2);

      // Complete processing -> should release lock and stop renewal
      await processedEventRepository.markCompleted('payment.confirmed', 'evt-redis-2', 'order-service');
      expect(mockReleaseLock).toHaveBeenCalledWith('kafka:claim:order-service:payment.confirmed:evt-redis-2', 'token-uuid-123');
      expect(processedEventRepository.isClaimActive('payment.confirmed', 'evt-redis-2', 'order-service')).toBe(false);

      // Further timer advances should NOT trigger renewLock
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockRenewLock).toHaveBeenCalledTimes(2);
    });

    it('releases Redis lock and stops renewal on markFailed', async () => {
      mockAcquireLock.mockResolvedValueOnce('token-uuid-456');
      mockRenewLock.mockResolvedValue(true);
      mockReleaseLock.mockResolvedValue(true);

      await processedEventRepository.claimProcessing(
        'payment.confirmed',
        'evt-redis-3',
        null,
        'order-service'
      );

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRenewLock).toHaveBeenCalledTimes(1);

      await processedEventRepository.markFailed('payment.confirmed', 'evt-redis-3', 'order-service');
      expect(mockReleaseLock).toHaveBeenCalledWith('kafka:claim:order-service:payment.confirmed:evt-redis-3', 'token-uuid-456');
      expect(processedEventRepository.isClaimActive('payment.confirmed', 'evt-redis-3', 'order-service')).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockRenewLock).toHaveBeenCalledTimes(1);
    });

    it('prevents overlapping renewal calls during slow heartbeat network requests', async () => {
      mockAcquireLock.mockResolvedValueOnce('token-uuid-slow');

      let resolveSlowRenew;
      mockRenewLock.mockImplementation(() => new Promise((resolve) => {
        resolveSlowRenew = resolve;
      }));

      await processedEventRepository.claimProcessing(
        'payment.confirmed',
        'evt-redis-slow',
        null,
        'order-service'
      );

      // First tick starts renewal (in flight)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRenewLock).toHaveBeenCalledTimes(1);

      // Next tick fires while first renewal is still pending -> must not call renewLock again
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRenewLock).toHaveBeenCalledTimes(1);

      // Resolve the first renewal
      resolveSlowRenew(true);
      await vi.advanceTimersByTimeAsync(1);

      // Subsequent tick after completion -> can renew again
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockRenewLock).toHaveBeenCalledTimes(2);

      // Cleanup
      resolveSlowRenew(true);
      await processedEventRepository.markCompleted('payment.confirmed', 'evt-redis-slow', 'order-service');
    });

    it('prevents second replica from reclaiming stale event if first replica still holds Redis lock', async () => {
      // Replica 1 claims and keeps lock
      mockAcquireLock.mockResolvedValueOnce('replica-1-lock');
      await processedEventRepository.claimProcessing('payment.confirmed', 'evt-stale-lock', null, 'order-service');

      // Make DB row look 10 minutes stale
      const key = recordKey('payment.confirmed', 'evt-stale-lock');
      const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      records.set(key, { ...records.get(key), started_at: staleTime });

      // Replica 2 attempts to reclaim, but Redis lock is held (returns null)
      mockAcquireLock.mockResolvedValueOnce(null);
      const replica2Claim = await processedEventRepository.claimProcessing(
        'payment.confirmed',
        'evt-stale-lock',
        null,
        'order-service',
        { staleProcessingAfterMs: 5 * 60 * 1000 }
      );

      expect(replica2Claim).toBe(false);
      // DB row was NOT modified by Replica 2
      expect(records.get(key).started_at).toBe(staleTime);
    });
  });

  describe('getStatus', () => {
    it('returns null for an event that has not been claimed', async () => {
      const status = await processedEventRepository.getStatus('payment.confirmed', 'evt-unseen', 'order-service');
      expect(status).toBeNull();
    });

    it('returns "processing" for an actively claimed event', async () => {
      await processedEventRepository.claimProcessing('payment.confirmed', 'evt-proc', null, 'order-service');
      const status = await processedEventRepository.getStatus('payment.confirmed', 'evt-proc', 'order-service');
      expect(status).toBe('processing');
    });

    it('returns "completed" after an event is marked completed', async () => {
      await processedEventRepository.claimProcessing('payment.confirmed', 'evt-comp', null, 'order-service');
      await processedEventRepository.markCompleted('payment.confirmed', 'evt-comp', 'order-service');
      const status = await processedEventRepository.getStatus('payment.confirmed', 'evt-comp', 'order-service');
      expect(status).toBe('completed');
    });

    it('returns "failed" after an event is marked failed', async () => {
      await processedEventRepository.claimProcessing('payment.confirmed', 'evt-fail', null, 'order-service');
      await processedEventRepository.markFailed('payment.confirmed', 'evt-fail', 'order-service');
      const status = await processedEventRepository.getStatus('payment.confirmed', 'evt-fail', 'order-service');
      expect(status).toBe('failed');
    });
  });
});

