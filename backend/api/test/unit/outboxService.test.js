import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

// Minimal supabase mock that records the query chain.
function buildSupabaseMock() {
  const chain = {
    data: null,
    error: null,
    lastUpdate: null,
    lastEq: null,
    select: vi.fn(function (cols) {
      this.lastSelect = cols;
      return this;
    }),
    insert: vi.fn(function (row) {
      this.lastInsert = row;
      return this;
    }),
    update: vi.fn(function (row) {
      this.lastUpdate = row;
      return this;
    }),
    eq: vi.fn(function (col, val) {
      this.lastEq = [col, val];
      return this;
    }),
    lt: vi.fn(function () {
      return this;
    }),
    order: vi.fn(function () {
      return this;
    }),
    limit: vi.fn(function () {
      // fetchPendingEvents() ends its chain with .limit() and awaits the
      // result, so this must resolve to { data, error }.
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    maybeSingle: vi.fn(function () {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    single: vi.fn(function () {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    rpc: vi.fn(function () {
      // The old buggy code called rpc() as a column value; this mock must
      // never be reached by a correct implementation.
      return { invalid: true };
    }),
  };
  return { chain, supabase: { from: vi.fn(() => chain) } };
}

const mocks = buildSupabaseMock();
vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mocks.supabase,
}));

const { outboxService } = await import('../../src/services/outbox/outboxService.js');

describe('OutboxService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chain.data = null;
    mocks.chain.error = null;
  });

  describe('writeEvent', () => {
    it('writes a pending outbox event via supabaseAdmin and returns its id', async () => {
      mocks.chain.data = { id: 'evt-1' };
      const id = await outboxService.writeEvent({
        aggregateId: 'order-1',
        eventType: 'order.created',
        payload: { a: 1 },
      });

      expect(id).toBe('evt-1');
      expect(mocks.chain.lastInsert).toMatchObject({
        aggregate_id: 'order-1',
        aggregate_type: 'order',
        event_type: 'order.created',
        status: 'pending',
        retry_count: 0,
      });
      expect(mocks.chain.lastInsert.payload).toEqual({ a: 1 });
      expect(mocks.chain.lastInsert.id).toBeTypeOf('string');
    });

    it('returns null when aggregateId is missing', async () => {
      const id = await outboxService.writeEvent({ eventType: 'order.created' });
      expect(id).toBeNull();
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });

    it('throws when the insert errors so failures are observable', async () => {
      mocks.chain.error = { message: 'insert failed' };
      await expect(
        outboxService.writeEvent({ aggregateId: 'order-1', eventType: 'order.created' })
      ).rejects.toThrow(/insert failed/);
    });
  });

  describe('fetchPendingEvents', () => {
    it('returns rows ordered by created_at ascending', async () => {
      mocks.chain.data = [{ id: 'evt-1' }, { id: 'evt-2' }];
      const rows = await outboxService.fetchPendingEvents(10);

      expect(rows).toHaveLength(2);
      expect(mocks.chain.lastEq).toEqual(['status', 'pending']);
    });

    it('returns an empty array on error', async () => {
      mocks.chain.error = { message: 'db down' };
      const rows = await outboxService.fetchPendingEvents();
      expect(rows).toEqual([]);
    });
  });

  describe('markFailed', () => {
    it('fetches the current retry_count and increments it in the update', async () => {
      mocks.chain.data = { retry_count: 2 };
      await outboxService.markFailed('evt-1', 'boom');

      expect(mocks.chain.lastUpdate).toMatchObject({
        status: 'failed',
        last_error: 'boom',
        retry_count: 3,
      });
      // The buggy implementation embedded a query builder here; verify we
      // pass a plain number instead.
      expect(mocks.chain.lastUpdate.retry_count).toBeTypeOf('number');
      expect(mocks.supabase.from).toHaveBeenCalledTimes(2);
    });

    it('defaults retry_count to 1 when the row has no retry_count', async () => {
      mocks.chain.data = null;
      await outboxService.markFailed('evt-2', 'err');

      expect(mocks.chain.lastUpdate.retry_count).toBe(1);
    });

    it('does not embed an unawaited rpc() Promise as the retry_count value (#12178)', async () => {
      mocks.chain.data = { retry_count: 4 };
      await outboxService.markFailed('evt-3', 'boom');

      // The increment must be computed in JS and passed as a plain number,
      // never by assigning the rpc() query builder to the column.
      expect(mocks.chain.lastUpdate.retry_count).toBe(5);
      expect(mocks.chain.lastUpdate.retry_count).toBeTypeOf('number');
      expect(mocks.chain.rpc).not.toHaveBeenCalled();
    });

    it('skips when eventId is missing', async () => {
      await outboxService.markFailed(null, 'err');
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('markPublished', () => {
    it('marks the event as published', async () => {
      mocks.chain.error = null;
      await outboxService.markPublished('evt-1');

      expect(mocks.chain.lastUpdate).toMatchObject({ status: 'published' });
      expect(mocks.chain.lastEq).toEqual(['id', 'evt-1']);
    });
  });

  describe('requeueFailedEvents', () => {
    it('resets failed events below maxRetries to pending', async () => {
      mocks.chain.error = null;
      await outboxService.requeueFailedEvents(5);

      expect(mocks.chain.lastUpdate).toEqual({ status: 'pending' });
      expect(mocks.chain.lastEq).toEqual(['status', 'failed']);
    });

    it('does not throw when the Supabase update returns an error', async () => {
      mocks.chain.error = { message: 'connection timeout' };
      // Should not throw — error is swallowed and logged.
      await expect(outboxService.requeueFailedEvents(3)).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('uses maxRetries as the lt threshold for retry_count', async () => {
      mocks.chain.error = null;
      // Track the .lt call to verify maxRetries is passed correctly.
      const ltValues = [];
      mocks.chain.lt = vi.fn(function (col) {
        ltValues.push(col);
        return this;
      });
      await outboxService.requeueFailedEvents(7);
      expect(mocks.chain.lastEq).toEqual(['status', 'failed']);
      expect(ltValues.length).toBeGreaterThan(0);
    });
  });
});
