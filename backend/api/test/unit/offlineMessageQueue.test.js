import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get redisClient() { return global.__mqRedis; },
}));

const { RedisMock } = await import('../mocks/redisMock.js');
const { enqueueOfflineMessage, drainOfflineQueue, getOfflineQueueSize } = await import('../../src/lib/messageQueue.js');

describe('offline message queue', () => {
  beforeEach(() => {
    global.__mqRedis = new RedisMock();
    global.__mqRedis.status = 'ready';
  });

  it('enqueue then drain returns messages in FIFO order and clears the queue', async () => {
    await enqueueOfflineMessage('u1', { text: 'first' });
    await enqueueOfflineMessage('u1', { text: 'second' });
    const drained = await drainOfflineQueue('u1');
    expect(drained.map((m) => m.text)).toEqual(['first', 'second']);
    expect(await getOfflineQueueSize('u1')).toBe(0, 'queue cleared after drain');
  });

  it('sets a 7-day TTL on enqueue', async () => {
    await enqueueOfflineMessage('u2', { text: 'hi' });
    const key = 'chat:offline_queue:u2';
    expect(global.__mqRedis.expirations.has(key)).toBe(true);
    const ttlMs = global.__mqRedis.expirations.get(key) - Date.now();
    expect(ttlMs).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
  });

  it('trims to the last 500 messages', async () => {
    for (let i = 0; i < 505; i++) {
      await enqueueOfflineMessage('u3', { seq: i });
    }
    expect(await getOfflineQueueSize('u3')).toBe(500);
    const drained = await drainOfflineQueue('u3');
    expect(drained[0].seq).toBe(5, 'oldest five dropped');
    expect(drained[499].seq).toBe(504);
  });

  it('drops the message (returns false) when Redis is not ready', async () => {
    global.__mqRedis.status = 'connecting';
    expect(await enqueueOfflineMessage('u4', { text: 'lost' })).toBe(false);
    expect(await drainOfflineQueue('u4')).toEqual([]);
  });

  it('queues are isolated per user', async () => {
    await enqueueOfflineMessage('a', { text: 'for-a' });
    await enqueueOfflineMessage('b', { text: 'for-b' });
    expect((await drainOfflineQueue('a'))[0].text).toBe('for-a');
    expect((await drainOfflineQueue('b'))[0].text).toBe('for-b');
  });
});
