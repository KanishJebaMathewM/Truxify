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
    rpcData: null,
    rpcError: null,
    lastUpdate: null,
    lastEq: null,
    lastRpcName: null,
    lastRpcParams: null,
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
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    maybeSingle: vi.fn(function () {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    single: vi.fn(function () {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    rpc: vi.fn(function (name, params) {
      this.lastRpcName = name;
      this.lastRpcParams = params;
      return Promise.resolve({ data: this.rpcData ?? null, error: this.rpcError ?? null });
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
    mocks.chain.rpcData = null;
    mocks.chain.rpcError = null;
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

  describe('claimBatch', () => {
    it('claims a batch via the claim_outbox_batch RPC with workerId', async () => {
      mocks.chain.rpcData = [{ id: 'evt-1' }, { id: 'evt-2' }];
      const rows = await outboxService.claimBatch({ workerId: 'replica-a', batchSize: 10 });

      expect(rows).toHaveLength(2);
      expect(mocks.chain.lastRpcName).toBe('claim_outbox_batch');
      expect(mocks.chain.lastRpcParams).toMatchObject({
        p_worker_id: 'replica-a',
        p_batch_size: 10,
      });
    });

    it('returns an empty array when the RPC errors', async () => {
      mocks.chain.rpcError = { message: 'db down' };
      const rows = await outboxService.claimBatch({ workerId: 'replica-a' });
      expect(rows).toEqual([]);
    });

    it('returns an empty array when workerId is missing', async () => {
      const rows = await outboxService.claimBatch({});
      expect(rows).toEqual([]);
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('reclaimExpiredClaims', () => {
    it('invokes reclaim_outbox_batch RPC', async () => {
      await outboxService.reclaimExpiredClaims();
      expect(mocks.chain.lastRpcName).toBe('reclaim_outbox_batch');
    });

    it('does not throw when the RPC errors', async () => {
      mocks.chain.rpcError = { message: 'connection timeout' };
      await expect(outboxService.reclaimExpiredClaims()).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('markFailed', () => {
    it('fetches the current retry_count and increments it in the update (ownership-fenced)', async () => {
      mocks.chain.data = { retry_count: 2 };
      await outboxService.markFailed('evt-1', 'replica-a', 'boom');

      expect(mocks.chain.lastUpdate).toMatchObject({
        status: 'failed',
        last_error: 'boom',
        retry_count: 3,
      });
      // Ownership fence: the update must be scoped to the claiming worker.
      expect(mocks.chain.lastEq).toEqual(['claimed_by', 'replica-a']);
      expect(mocks.chain.lastUpdate.retry_count).toBeTypeOf('number');
      expect(mocks.supabase.from).toHaveBeenCalledTimes(2);
    });

    it('defaults retry_count to 1 when the row has no retry_count', async () => {
      mocks.chain.data = null;
      await outboxService.markFailed('evt-2', 'replica-a', 'err');

      expect(mocks.chain.lastUpdate.retry_count).toBe(1);
    });

    it('skips when eventId is missing', async () => {
      await outboxService.markFailed(null, 'replica-a', 'err');
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('markPublished', () => {
    it('marks the event published and returns true when the owner matches', async () => {
      mocks.chain.error = null;
      mocks.chain.data = [{ id: 'evt-1' }];
      const owned = await outboxService.markPublished('evt-1', 'replica-a');

      expect(owned).toBe(true);
      expect(mocks.chain.lastUpdate).toMatchObject({ status: 'published' });
      // Ownership fence so a reclaimed row is not double-resolved.
      expect(mocks.chain.lastEq).toEqual(['claimed_by', 'replica-a']);
    });

    it('returns false when no row matched (lost ownership)', async () => {
      mocks.chain.data = [];
      const owned = await outboxService.markPublished('evt-1', 'replica-a');
      expect(owned).toBe(false);
    });

    it('skips when workerId is missing', async () => {
      const owned = await outboxService.markPublished('evt-1');
      expect(owned).toBe(false);
      expect(mocks.supabase.from).not.toHaveBeenCalled();
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
