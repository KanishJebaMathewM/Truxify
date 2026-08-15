import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const mockSupabase = {
  from: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: mockSupabase,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('OutboxService', () => {
  let OutboxService, service;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../../src/services/outbox/outboxService.js');
    OutboxService = mod.OutboxService;
    service = new OutboxService();
  });

  describe('writeEvent', () => {
    it('returns null when aggregateId is missing', async () => {
      const result = await service.writeEvent({ eventType: 'order.created' });
      expect(result).toBeNull();
    });

    it('returns null when eventType is missing', async () => {
      const result = await service.writeEvent({ aggregateId: 'order-123' });
      expect(result).toBeNull();
    });

    it('returns null when both aggregateId and eventType are missing', async () => {
      const result = await service.writeEvent({});
      expect(result).toBeNull();
    });

    it('inserts event to outbox_events table when valid', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'evt-123' }, error: null }),
          }),
        }),
      });
      mockSupabase.from.mockReturnValue(mockInsert());

      const result = await service.writeEvent({
        aggregateId: 'order-456',
        eventType: 'order.shipped',
        payload: { driver: 'driver-1' },
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('outbox_events');
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

  describe('fetchPendingEvents', () => {
    it('returns empty array on error', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
          }),
        }),
      });
      mockSupabase.from.mockReturnValue(mockSelect());

      const result = await service.fetchPendingEvents();
      expect(result).toEqual([]);
    });

    it('returns data array when query succeeds', async () => {
      const events = [{ id: '1' }, { id: '2' }];
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: events, error: null }),
          }),
        }),
      });
      mockSupabase.from.mockReturnValue(mockSelect());

      const result = await service.fetchPendingEvents();
      expect(result).toEqual(events);
    });

    it('skips when eventId is missing', async () => {
      await outboxService.markFailed(null, 'replica-a', 'err');
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('markPublished', () => {
    it('updates status to published', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.from.mockReturnValue(mockUpdate());

      await service.markPublished('evt-123');
      expect(mockSupabase.from).toHaveBeenCalledWith('outbox_events');
    });
  });

  describe('markFailed', () => {
    it('calls from with outbox_events', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      mockSupabase.from.mockReturnValue(mockUpdate());

      await service.markFailed('evt-123', 'Network timeout');
      expect(mockSupabase.from).toHaveBeenCalledWith('outbox_events');
    });

    it('does not throw when the Supabase update returns an error', async () => {
      mocks.chain.error = { message: 'connection timeout' };
      // Should not throw — error is swallowed and logged.
      await expect(outboxService.requeueFailedEvents(3)).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('uses maxRetries as the lt threshold for attempts', async () => {
      mocks.chain.error = null;
      const ltValues = [];
      mocks.chain.lt = vi.fn(function (col) {
        ltValues.push(col);
        return this;
      });
      await outboxService.requeueFailedEvents(7);
      expect(mocks.chain.lastEq).toEqual(['status', 'publishing']);
      expect(ltValues.length).toBeGreaterThan(0);
    });
  });

  describe('deadLetterExhaustedEvents', () => {
    it('moves exhausted events to outbox_dlq and removes them from outbox_events', async () => {
      mocks.chain.error = null;
      mocks.chain.data = [
        {
          id: 'evt-x',
          aggregate_id: 'order-x',
          aggregate_type: 'order',
          event_type: 'order.created',
          payload: { a: 1 },
          last_error: 'kafka down',
          retry_count: 5,
          last_attempted_at: '2026-08-11T00:00:00.000Z',
          created_at: '2026-08-10T00:00:00.000Z',
        },
      ];

      await outboxService.deadLetterExhaustedEvents(5);

      // A DLQ row is written with status 'pending' for replay.
      expect(mocks.supabase.from).toHaveBeenCalledWith('outbox_dlq');
      expect(Array.isArray(mocks.chain.lastInsert)).toBe(true);
      expect(mocks.chain.lastInsert[0]).toMatchObject({
        original_id: 'evt-x',
        aggregate_id: 'order-x',
        event_type: 'order.created',
        status: 'pending',
      });
      // The source row is removed from outbox_events via delete().in().
      expect(mocks.chain.delete).toHaveBeenCalled();
      expect(mocks.chain.in).toHaveBeenCalledWith('id', ['evt-x']);
      // An alert is emitted for operators to replay.
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('is a no-op when there are no exhausted events', async () => {
      mocks.chain.error = null;
      mocks.chain.data = [];
      await outboxService.deadLetterExhaustedEvents(5);

      expect(mocks.supabase.from).not.toHaveBeenCalledWith('outbox_dlq');
    });
  });

  describe('replayDeadLetter', () => {
    it('reinserts a DLQ row into outbox_events as pending and marks it replayed', async () => {
      mocks.chain.error = null;
      mocks.chain.data = {
        id: 'dlq-1',
        original_id: 'evt-x',
        aggregate_id: 'order-x',
        aggregate_type: 'order',
        event_type: 'order.created',
        payload: { a: 1 },
      };

      const replayedId = await outboxService.replayDeadLetter('dlq-1');

      expect(replayedId).toBe('evt-x');
      expect(mocks.chain.lastInsert).toMatchObject({
        id: 'evt-x',
        aggregate_id: 'order-x',
        event_type: 'order.created',
        status: 'pending',
        retry_count: 0,
      });
      expect(mocks.chain.lastUpdate).toMatchObject({ status: 'replayed' });
    });

    it('returns null when the DLQ id is missing', async () => {
      const replayedId = await outboxService.replayDeadLetter(null);
      expect(replayedId).toBeNull();
      expect(mocks.supabase.from).not.toHaveBeenCalled();
    });
  });
});
