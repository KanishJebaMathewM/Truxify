import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  db: { from: vi.fn() }, redis: { set: vi.fn(), eval: vi.fn() }, notify: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({ supabaseAdmin: mocks.db, redisClient: mocks.redis }));
vi.mock('../../src/services/notificationService.js', () => ({ sendPushNotification: mocks.notify }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mocks.logger }));
import { processDocumentExpiryBatch } from '../../src/services/documentExpiryService.js';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const documents = [1, 2].map(id => ({
  id: `doc-${id}`, driver_id: 'driver', document_type: 'insurance', valid_until: '2026-10-31T00:00:00Z',
}));
let readPage;
let readHistory;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  vi.resetAllMocks();
  mocks.redis.set.mockResolvedValue('OK');
  mocks.redis.eval.mockResolvedValue(1);
  mocks.notify.mockResolvedValue({ success: true });
  readPage = vi.fn().mockResolvedValue({ data: [] });
  readHistory = vi.fn().mockResolvedValue({ data: [] });
  mocks.db.from.mockImplementation(table => {
    const builder = {
      select: () => builder, not: () => builder, eq: () => builder,
      lte: () => builder, order: () => builder,
      gte: () => table === 'notifications' ? readHistory() : builder,
      range: (...args) => readPage(...args),
    };
    return builder;
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function renew() { await vi.advanceTimersByTimeAsync(300000); }
function expectSafeRelease() {
  const token = mocks.redis.set.mock.calls[0][1];
  expect(mocks.redis.eval).toHaveBeenLastCalledWith(
    expect.stringContaining('if redis.call("get", KEYS[1]) == ARGV[1]'),
    1, 'document:expiry:worker:lock', token,
  );
  expect(vi.getTimerCount()).toBe(0);
}

describe('document expiry lease-loss boundaries', () => {
  it.each(['lost', 'error'])('stops a pending document page after renewal %s', async failure => {
    const page = deferred();
    readPage.mockReturnValueOnce(page.promise);
    const batch = processDocumentExpiryBatch();
    await vi.waitFor(() => expect(readPage).toHaveBeenCalledOnce());
    if (failure === 'lost') mocks.redis.eval.mockResolvedValueOnce(0);
    else mocks.redis.eval.mockRejectedValueOnce(new Error('Redis unavailable'));
    await renew();
    page.resolve({ data: documents });
    await batch;
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(readPage).toHaveBeenCalledOnce();
    expect(readHistory).not.toHaveBeenCalled();
    expectSafeRelease();
  });
  it('rechecks after notification-history lookup before sending', async () => {
    const history = deferred();
    readPage.mockResolvedValueOnce({ data: documents });
    readHistory.mockReturnValueOnce(history.promise);
    const batch = processDocumentExpiryBatch();
    await vi.waitFor(() => expect(readHistory).toHaveBeenCalledOnce());
    mocks.redis.eval.mockResolvedValueOnce(0);
    await renew();
    history.resolve({ data: [] });
    await batch;
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(readPage).toHaveBeenCalledOnce();
    expectSafeRelease();
  });
  it('lets an already dispatched push finish but stops subsequent documents', async () => {
    const push = deferred();
    readPage.mockResolvedValueOnce({ data: documents });
    mocks.notify.mockReturnValueOnce(push.promise);
    const batch = processDocumentExpiryBatch();
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    mocks.redis.eval.mockResolvedValueOnce(0);
    await renew();
    push.resolve({ success: true });
    await batch;
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(readHistory).toHaveBeenCalledOnce();
    expect(readPage).toHaveBeenCalledOnce();
    expectSafeRelease();
  });
  it('does not revive a lost batch on later timer ticks', async () => {
    const page = deferred();
    readPage.mockReturnValueOnce(page.promise);
    const batch = processDocumentExpiryBatch();
    await vi.waitFor(() => expect(readPage).toHaveBeenCalledOnce());
    mocks.redis.eval.mockResolvedValueOnce(0);
    await renew();
    await renew();
    expect(mocks.redis.eval).toHaveBeenCalledOnce();
    page.resolve({ data: documents });
    await batch;
    expect(mocks.notify).not.toHaveBeenCalled();
    expectSafeRelease();
  });
  it('continues after a healthy renewal and preserves notification metadata', async () => {
    const page = deferred();
    readPage.mockReturnValueOnce(page.promise);
    const batch = processDocumentExpiryBatch();
    await vi.waitFor(() => expect(readPage).toHaveBeenCalledOnce());
    await renew();
    page.resolve({ data: [documents[0]] });
    await batch;
    expect(mocks.notify).toHaveBeenCalledWith('driver', 'Document Expiry Alert',
      expect.stringContaining('Insurance Policy expires in 30 days'), 'document',
      expect.objectContaining({ documentId: 'doc-1', daysRemaining: 30 }));
    expect(readPage).toHaveBeenCalledTimes(3);
    expectSafeRelease();
  });
});
