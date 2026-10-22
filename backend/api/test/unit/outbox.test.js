import { describe, test, expect, vi, beforeEach } from 'vitest';
import outboxService from '../../src/outbox/service.js';
import outboxRelay from '../../src/outbox/relay.js';

const jest = vi;

describe('Outbox Unit Tests', () => {
  let mockDb;
  let mockPublisher;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      writeEvent: jest.fn(),
      getPendingEvents: jest.fn(),
      markPublished: jest.fn(),
      markFailed: jest.fn(),
    };

    mockPublisher = {
      publishAndReport: jest.fn(),
    };
  });

  describe('publish / writeEvent', () => {
    test('adds event to outbox with pending status', async () => {
      const payload = { type: 'USER_CREATED', data: { id: 1 } };
      mockDb.writeEvent.mockResolvedValue({ event_id: 'evt_123', status: 'pending', ...payload });

      const result = await outboxService.publish(payload, { db: mockDb });

      expect(mockDb.writeEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'USER_CREATED',
        status: 'pending',
      }));
      expect(result).toHaveProperty('event_id', 'evt_123');
    });
  });

  describe('flush / relay operations', () => {
    test('sends pending events and marks them published', async () => {
      const pendingEvents = [
        { event_id: 'evt_1', type: 'ORDER_CREATED', status: 'pending' },
        { event_id: 'evt_2', type: 'PAYMENT_COMPLETED', status: 'pending' },
      ];

      mockDb.getPendingEvents.mockResolvedValue(pendingEvents);
      mockPublisher.publishAndReport.mockResolvedValue(true);

      await outboxRelay.flush({ db: mockDb, publisher: mockPublisher });

      expect(mockDb.getPendingEvents).toHaveBeenCalledTimes(1);
      expect(mockPublisher.publishAndReport).toHaveBeenCalledTimes(2);
      expect(mockDb.markPublished).toHaveBeenCalledWith('evt_1');
      expect(mockDb.markPublished).toHaveBeenCalledWith('evt_2');
    });

    test('handles publish errors and marks events as failed', async () => {
      const pendingEvent = { event_id: 'evt_3', type: 'USER_UPDATED', status: 'pending' };
      mockDb.getPendingEvents.mockResolvedValue([pendingEvent]);
      
      const publishError = new Error('Network timeout');
      mockPublisher.publishAndReport.mockRejectedValue(publishError);

      await outboxRelay.flush({ db: mockDb, publisher: mockPublisher });

      expect(mockPublisher.publishAndReport).toHaveBeenCalledWith(pendingEvent);
      expect(mockDb.markFailed).toHaveBeenCalledWith('evt_3', publishError);
      expect(mockDb.markPublished).not.toHaveBeenCalled();
    });

    test('flush with empty outbox is a no-op', async () => {
      mockDb.getPendingEvents.mockResolvedValue([]);

      await outboxRelay.flush({ db: mockDb, publisher: mockPublisher });

      expect(mockDb.getPendingEvents).toHaveBeenCalledTimes(1);
      expect(mockPublisher.publishAndReport).not.toHaveBeenCalled();
      expect(mockDb.markPublished).not.toHaveBeenCalled();
      expect(mockDb.markFailed).not.toHaveBeenCalled();
    });
  });
});
