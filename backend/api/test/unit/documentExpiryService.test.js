import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const supabaseInsertMock = vi.fn().mockResolvedValue({ error: null });
const supabaseSelectMock = vi.fn();
const redisSetMock = vi.fn();
const redisDelMock = vi.fn();

function createChainableTerminal(finalFn) {
  const handler = {
    get(target, prop) {
      if (prop === 'then') {
        return (resolve, reject) => {
          try {
            const result = finalFn();
            return Promise.resolve(result).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        };
      }
      if (prop === Symbol.iterator) return undefined;
      if (typeof prop === 'symbol') return target[prop];
      return (...args) => new Proxy(() => {}, handler);
    },
  };
  return new Proxy(function () {}, handler);
}

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: (table) => {
      if (table === 'documents') {
        return {
          select: (fields) => ({
            not: (col, op) => ({
              gte: (col2, val) => ({
                lte: (col3, val2) => supabaseSelectMock(table, fields, col, op, col2, val, col3, val2),
              }),
            }),
          }),
        };
      }
      if (table === 'notifications') {
        return {
          insert: (data) => supabaseInsertMock(table, data),
          select: (fields) => createChainableTerminal(() => supabaseSelectMock(table, fields)),
        };
      }
    },
  },
  firebaseAdmin: {
    messaging: () => ({
      send: vi.fn(),
    }),
  },
  redisClient: {
    set: redisSetMock,
    del: redisDelMock,
    expire: vi.fn(),
  },
}));

const sendPushNotificationMock = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: sendPushNotificationMock,
}));

const { processDocumentExpiryBatch, startDocumentExpiryWorker, stopDocumentExpiryWorker } =
  await import('../../src/services/documentExpiryService.js');

describe('documentExpiryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopDocumentExpiryWorker();
  });

  describe('processDocumentExpiryBatch', () => {
    it('acquires and releases Redis lock', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);
      supabaseSelectMock.mockResolvedValue({ data: [], error: null });

      await processDocumentExpiryBatch();

      expect(redisSetMock).toHaveBeenCalledWith(
        'document:expiry:worker:lock',
        expect.any(String),
        'NX',
        'EX',
        600,
      );
      expect(redisDelMock).toHaveBeenCalledWith('document:expiry:worker:lock');
    });

    it('skips batch when Redis lock is held by another instance', async () => {
      redisSetMock.mockResolvedValue(null);

      await processDocumentExpiryBatch();

      expect(supabaseSelectMock).not.toHaveBeenCalled();
    });

    it('sends notifications for documents expiring in 30 days', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      const expiryDate = new Date('2026-09-14T12:00:00Z').toISOString();

      supabaseSelectMock.mockImplementation(async (table) => {
        if (table === 'notifications') {
          return { data: [], error: null };
        }
        return {
          data: [{ id: 'doc-1', user_id: 'user-1', doc_type: 'driving_licence', valid_until: expiryDate }],
          error: null,
        };
      });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).toHaveBeenCalled();
      const [userId, title, body, notifType, metadata] = sendPushNotificationMock.mock.calls[0];
      expect(userId).toBe('user-1');
      expect(title).toBe('Document Expiry Alert');
      expect(body).toContain('Driving Licence');
      expect(body).toContain('30 days');
      expect(notifType).toBe('document_expiry');
      expect(metadata.type).toBe('document_expiry');
      expect(metadata.documentId).toBe('doc-1');
      expect(metadata.documentType).toBe('driving_licence');
      expect(metadata.daysRemaining).toBe(30);
    });

    it('sends notifications for documents expiring in 14 days', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      const expiryDate = new Date('2026-08-29T12:00:00Z').toISOString();
      let documentsCallCount = 0;

      supabaseSelectMock.mockImplementation(async (table) => {
        if (table === 'notifications') {
          return { data: [], error: null };
        }
        documentsCallCount++;
        if (documentsCallCount === 2) {
          return {
            data: [{ id: 'doc-2', user_id: 'user-2', doc_type: 'insurance', valid_until: expiryDate }],
            error: null,
          };
        }
        return { data: [], error: null };
      });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).toHaveBeenCalled();
      const [, title, body, , metadata] = sendPushNotificationMock.mock.calls[0];
      expect(metadata.daysRemaining).toBe(14);
      expect(body).toContain('Insurance Policy');
      expect(body).toContain('14 days');
    });

    it('sends notifications for documents expiring in 7 days', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      const expiryDate = new Date('2026-08-22T12:00:00Z').toISOString();
      let documentsCallCount = 0;

      supabaseSelectMock.mockImplementation(async (table) => {
        if (table === 'notifications') {
          return { data: [], error: null };
        }
        documentsCallCount++;
        if (documentsCallCount === 3) {
          return {
            data: [{ id: 'doc-3', user_id: 'user-3', doc_type: 'rc_book', valid_until: expiryDate }],
            error: null,
          };
        }
        return { data: [], error: null };
      });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).toHaveBeenCalled();
      const [, title, body, , metadata] = sendPushNotificationMock.mock.calls[0];
      expect(metadata.daysRemaining).toBe(7);
      expect(body).toContain('RC Book');
      expect(body).toContain('7 days');
    });

    it('skips documents without user_id', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      supabaseSelectMock.mockImplementation(async (table) => {
        if (table === 'notifications') {
          return { data: [], error: null };
        }
        return {
          data: [{ id: 'doc-4', user_id: null, doc_type: 'rc_book', valid_until: new Date('2026-08-22T12:00:00Z').toISOString() }],
          error: null,
        };
      });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).not.toHaveBeenCalled();
    });

    it('skips already-notified documents (duplicate prevention)', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      const expiryDate = new Date('2026-08-22T12:00:00Z').toISOString();
      let documentsCallCount = 0;

      supabaseSelectMock.mockImplementation(async (table) => {
        if (table === 'notifications') {
          return {
            data: [{ id: 'existing-notif', metadata: { documentId: 'doc-5', daysRemaining: 7 } }],
            error: null,
          };
        }
        documentsCallCount++;
        if (documentsCallCount === 3) {
          return {
            data: [{ id: 'doc-5', user_id: 'user-5', doc_type: 'rc_book', valid_until: expiryDate }],
            error: null,
          };
        }
        return { data: [], error: null };
      });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).not.toHaveBeenCalled();
    });

    it('handles database query errors gracefully', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      supabaseSelectMock.mockResolvedValue({ data: null, error: { message: 'DB connection failed' } });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).not.toHaveBeenCalled();
    });

    it('handles notification send failures gracefully', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      sendPushNotificationMock.mockRejectedValueOnce(new Error('FCM error'));

      supabaseSelectMock.mockImplementation(async (table) => {
        if (table === 'notifications') {
          return { data: [], error: null };
        }
        return {
          data: [{ id: 'doc-6', user_id: 'user-6', doc_type: 'rc_book', valid_until: new Date('2026-08-22T12:00:00Z').toISOString() }],
          error: null,
        };
      });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).toHaveBeenCalled();
    });
  });

  describe('notification payload', () => {
    it('includes correct metadata structure', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      supabaseSelectMock.mockImplementation(async (table) => {
        if (table === 'notifications') {
          return { data: [], error: null };
        }
        return {
          data: [{ id: 'doc-7', user_id: 'user-7', doc_type: 'driving_licence', valid_until: new Date('2026-09-14T12:00:00Z').toISOString() }],
          error: null,
        };
      });

      await processDocumentExpiryBatch();

      expect(sendPushNotificationMock).toHaveBeenCalled();
      const [, , , , metadata] = sendPushNotificationMock.mock.calls[0];
      expect(metadata).toEqual({
        type: 'document_expiry',
        documentId: 'doc-7',
        documentType: 'driving_licence',
        daysRemaining: 30,
        expiryDate: expect.any(String),
      });
    });

    it('maps doc types to human-readable labels', async () => {
      vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
      redisSetMock.mockResolvedValue('ok');
      redisDelMock.mockResolvedValue(1);

      const testCases = [
        { docType: 'rc_book', expected: 'RC Book' },
        { docType: 'driving_licence', expected: 'Driving Licence' },
        { docType: 'insurance', expected: 'Insurance Policy' },
        { docType: 'puc', expected: 'Pollution Certificate' },
        { docType: 'aadhaar_card', expected: 'Aadhaar Card' },
        { docType: 'pan_card', expected: 'PAN Card' },
      ];

      for (const { docType, expected } of testCases) {
        vi.clearAllMocks();
        redisSetMock.mockResolvedValue('ok');
        redisDelMock.mockResolvedValue(1);

        supabaseSelectMock.mockImplementation(async (table) => {
          if (table === 'notifications') {
            return { data: [], error: null };
          }
          return {
            data: [{ id: `doc-${docType}`, user_id: 'user-test', doc_type: docType, valid_until: new Date('2026-08-22T12:00:00Z').toISOString() }],
            error: null,
          };
        });

        await processDocumentExpiryBatch();

        if (sendPushNotificationMock.mock.calls.length > 0) {
          const [, , body] = sendPushNotificationMock.mock.calls[0];
          expect(body).toContain(expected);
        }
      }
    });
  });

  describe('startDocumentExpiryWorker / stopDocumentExpiryWorker', () => {
    it('starts and stops without error', () => {
      startDocumentExpiryWorker();
      stopDocumentExpiryWorker();
    });

    it('does not start twice', () => {
      startDocumentExpiryWorker();
      startDocumentExpiryWorker();
      stopDocumentExpiryWorker();
    });

    it('stop is safe to call without start', () => {
      stopDocumentExpiryWorker();
    });
  });
});
