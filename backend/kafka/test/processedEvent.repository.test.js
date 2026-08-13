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
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../api/src/config/db.js', () => ({
  supabaseAdmin: { from: vi.fn() },
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
  const where = { topic: undefined, event_id: undefined, status: undefined };
  let updates = null;

  const applyUpdate = () => {
    const existing = records.get(recordKey(where.topic, where.event_id));
    if (!existing) return 0;
    if (where.status !== undefined && existing.status !== where.status) return 0;
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
});
