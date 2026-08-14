import { describe, it, expect, vi } from 'vitest';

const sendPushNotificationMock = vi.fn().mockResolvedValue({ success: true });

function makeBuilder(result) {
  const builder = {
    select() { return this; },
    not() { return this; },
    gte() { return this; },
    lte() { return this; },
    order() { return this; },
    range() { return this; },
    eq() { return this; },
    maybeSingle() { return this; },
    then(resolve) { return resolve(result); },
  };
  return builder;
}

const resultsByTable = {
  documents: { data: [{ id: 'doc-1', user_id: 'user-1', doc_type: 'rc_book', valid_until: '2099-01-01T00:00:00.000Z' }], error: null },
  notifications: { data: [], error: null },
};

const supabaseAdminBuilder = {
  from: vi.fn((table) => makeBuilder(resultsByTable[table] ?? { data: [], error: null })),
};
const supabaseAnonBuilder = {
  from: vi.fn(() => makeBuilder({ data: [], error: null })),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseAnonBuilder,
  supabaseAdmin: supabaseAdminBuilder,
  redisClient: {
    set: vi.fn().mockResolvedValue('OK'),
    eval: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: sendPushNotificationMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('documentExpiryService', () => {
  it('routes documents and notifications queries through the service-role client, never the anon client', async () => {
    const { processDocumentExpiryBatch } = await import('../../src/services/documentExpiryService.js');

    await processDocumentExpiryBatch();

    expect(supabaseAdminBuilder.from).toHaveBeenCalledWith('documents');
    expect(supabaseAdminBuilder.from).toHaveBeenCalledWith('notifications');
    expect(supabaseAnonBuilder.from).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).toHaveBeenCalledWith(
      'user-1',
      expect.any(String),
      expect.any(String),
      'document',
      expect.objectContaining({ documentId: 'doc-1', daysRemaining: expect.any(Number) })
    );
  });

  it('pages the window sweep past the PostgREST 1000-row cap until fewer than a full page remains', async () => {
    const pageOf1000 = Array.from({ length: 1000 }, (_, i) => ({
      id: `doc-${i + 1}`,
      user_id: 'user-1',
      doc_type: 'rc_book',
      valid_until: '2099-01-01T00:00:00.000Z',
    }));

    const notificationsResult = { data: [], error: null };
    const responses = [pageOf1000, [{ id: 'doc-tail', user_id: 'user-2', doc_type: 'insurance', valid_until: '2099-02-01T00:00:00.000Z' }]];

    const paginatedBuilder = {
      from: vi.fn((table) => {
        if (table === 'documents') {
          return makeBuilder({ data: responses.shift() ?? [], error: null });
        }
        return makeBuilder(notificationsResult);
      }),
    };

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      supabase: supabaseAnonBuilder,
      supabaseAdmin: paginatedBuilder,
      redisClient: {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      },
    }));

    const { processDocumentExpiryBatch } = await import('../../src/services/documentExpiryService.js');
    await processDocumentExpiryBatch();

    const docCalls = paginatedBuilder.from.mock.calls.filter(([table]) => table === 'documents');
    expect(docCalls.length).toBeGreaterThan(1);
    expect(sendPushNotificationMock).toHaveBeenCalledWith(
      'user-2',
      expect.any(String),
      expect.any(String),
      'document',
      expect.objectContaining({ documentId: 'doc-tail' })
    );
  });
});
