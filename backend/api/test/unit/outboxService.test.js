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

function buildSupabaseMock() {
  const chain = {
    data: null,
    error: null,
    lastTable: null,
    lastInsert: null,
    lastUpdate: null,
    lastSelect: null,
    lastEq: [],
    lastGte: null,
    lastLt: null,
    lastIn: null,
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
    delete: vi.fn(function () {
      return this;
    }),
    eq: vi.fn(function (col, val) {
      this.lastEq.push([col, val]);
      return this;
    }),
    gte: vi.fn(function (col, val) {
      this.lastGte = [col, val];
      return this;
    }),
    lte: vi.fn(function (col, val) {
      this.lastLte = [col, val];
      return this;
    }),
    lt: vi.fn(function (col, val) {
      this.lastLt = [col, val];
      return this;
    }),
    in: vi.fn(function (col, val) {
      this.lastIn = [col, val];
      return Promise.resolve({ data: null, error: this.error });
    }),
    order: vi.fn(function () {
      return this;
    }),
    limit: vi.fn(function () {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    single: vi.fn(function () {
      return Promise.resolve({ data: this.data, error: this.error });
    }),
    then: function (resolve, reject) {
      return Promise.resolve({ data: this.data, error: this.error }).then(resolve, reject);
    },
  };

  const supabase = {
    rpc: vi.fn(() => Promise.resolve({ data: chain.data, error: chain.error })),
    from: vi.fn((table) => {
      chain.lastTable = table;
      return chain;
    }),
  };

  return { chain, supabase };
}

const mocks = buildSupabaseMock();
vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabaseAdmin: mocks.supabase,
}));

const { OutboxService, outboxService } = await import('../../src/services/outbox/outboxService.js');

describe('OutboxService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chain.data = null;
    mocks.chain.error = null;
    mocks.chain.lastEq = [];
    mocks.chain.lastTable = null;
    mocks.chain.lastInsert = null;
    mocks.chain.lastUpdate = null;
  });

  describe('writeEvent', () => {
    it('writes a pending outbox event via supabaseAdmin and returns its id', async () => {
      mocks.chain.data = { event_id: 'evt-1' };
      const id = await outboxService.writeEvent({
        aggregateId: 'order-1',
        eventType: 'order.created',
        payload: { a: 1 },
      });

      expect(id).toBe('evt-1');
      expect(mocks.chain.lastTable).toBe('event_outbox');
      expect(mocks.chain.lastInsert).toMatchObject({
        aggregate_id: 'order-1',
        event_type: 'order.created',
        status: 'pending',
        payload: { a: 1 },
      });
    });

    it('returns null when aggregateId is missing', async () => {
      const id = await outboxService.writeEvent({ eventType: 'order.created' });
      expect(id).toBeNull();
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });

    it('returns null when eventType is missing', async () => {
      const id = await outboxService.writeEvent({ aggregateId: 'order-1' });
      expect(id).toBeNull();
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });

    it('swallows errors and returns null when insert fails', async () => {
      mocks.chain.error = { message: 'insert failed' };
      const id = await outboxService.writeEvent({ aggregateId: 'order-1', eventType: 'order.created' });
      expect(id).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('fetchPendingEvents', () => {
    it('returns pending events ordered by created_at', async () => {
      mocks.chain.data = [{ event_id: 'evt-1' }, { event_id: 'evt-2' }];
      const rows = await outboxService.fetchPendingEvents(10);

      expect(rows).toHaveLength(2);
      expect(mocks.chain.lastTable).toBe('event_outbox');
      expect(mocks.chain.select).toHaveBeenCalledWith('*');
      expect(mocks.chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
      expect(mocks.chain.limit).toHaveBeenCalledWith(10);
    });

    it('returns an empty array on query error', async () => {
      mocks.chain.error = { message: 'db down' };
      const rows = await outboxService.fetchPendingEvents();
      expect(rows).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('markPublished', () => {
    it('settles the exact claim generation and reports accepted success', async () => {
      mocks.chain.data = true;
      expect(await outboxService.markPublished('evt-1', 2)).toBe(true);
      expect(mocks.supabase.rpc).toHaveBeenCalledWith('settle_leased_outbox_event', expect.objectContaining({
        p_event_id: 'evt-1', p_claim_attempt: 2, p_published: true,
      }));
    });
    it('returns false when no claim matched', async () => {
      mocks.chain.data = false;
      expect(await outboxService.markPublished('evt-nonexistent', 2)).toBe(false);
    });
  });

  describe('markFailed', () => {
    it('schedules a fenced retry without incrementing the claim count twice', async () => {
      mocks.chain.data = true;
      expect(await outboxService.markFailed('evt-1', 'worker-1', 'network timeout', 2)).toBe(true);
      expect(mocks.supabase.rpc).toHaveBeenCalledWith('settle_leased_outbox_event', expect.objectContaining({
        p_event_id: 'evt-1', p_claim_attempt: 2, p_published: false,
        p_error: 'network timeout', p_retry_ms: 2000,
      }));
    });
    it('returns false when eventId or workerId is missing', async () => {
      expect(await outboxService.markFailed(null, 'worker-1', 'err', 2)).toBe(false);
      expect(await outboxService.markFailed('evt-1', null, 'err', 2)).toBe(false);
    });
  });

  describe('deadLetterExhaustedEvents', () => {
    it('moves exhausted events from outbox_events to outbox_dlq', async () => {
      mocks.chain.data = [
        {
          id: 'evt-1',
          aggregate_id: 'ord-1',
          event_type: 'order.cancelled',
          retry_count: 5,
        },
      ];

      await outboxService.deadLetterExhaustedEvents(5);

      expect(mocks.supabase.from).toHaveBeenCalledWith('outbox_events');
      expect(mocks.supabase.from).toHaveBeenCalledWith('outbox_dlq');
      expect(mocks.chain.gte).toHaveBeenCalledWith('retry_count', 5);
    });

    it('is a no-op when no events are exhausted', async () => {
      mocks.chain.data = [];
      await outboxService.deadLetterExhaustedEvents(5);
      expect(mocks.supabase.from).not.toHaveBeenCalledWith('outbox_dlq');
    });
  });

  describe('requeueFailedEvents', () => {
    it('resets only expired publishing events back to pending', async () => {
      await outboxService.requeueFailedEvents(5);
      expect(mocks.chain.lastTable).toBe('event_outbox');
      expect(mocks.chain.lastUpdate).toEqual({ status: 'pending' });
      expect(mocks.chain.eq).toHaveBeenCalledWith('status', 'publishing');
      expect(mocks.chain.lt).toHaveBeenCalledWith('attempts', 5);
      expect(mocks.chain.lte).toHaveBeenCalledWith('next_attempt_at', expect.any(String));
    });
  });

  describe('replayDeadLetter', () => {
    it('re-inserts DLQ event into outbox_events and marks replayed', async () => {
      mocks.chain.data = {
        id: 'dlq-1',
        original_id: 'evt-1',
        aggregate_id: 'ord-1',
        event_type: 'order.cancelled',
        payload: {},
      };

      const result = await outboxService.replayDeadLetter('dlq-1');
      expect(result).toBe('evt-1');
      expect(mocks.chain.lastUpdate).toMatchObject({ status: 'replayed' });
    });

    it('returns null when dlqId is missing', async () => {
      const result = await outboxService.replayDeadLetter(null);
      expect(result).toBeNull();
    });
  });
});
