import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const redis = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), values: new Map() }));
vi.mock('../../src/config/db.js', () => ({ upstashRedisClient: redis }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { getTruckSearchVersion, invalidateBookingCaches } from '../../src/utils/cacheInvalidation.js';
import { cacheMiddleware } from '../../src/middleware/cacheMiddleware.js';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  redis.values.clear();
  redis.get.mockReset().mockImplementation(async key => redis.values.get(key) ?? null);
  redis.set.mockReset().mockImplementation(async (key, value) => { redis.values.set(key, value); return 'OK'; });
});
afterEach(() => vi.useRealTimers());
function searchApp() {
  let result = 'truck-available';
  const handler = vi.fn((_req, res) => res.json({ result }));
  const app = express();
  // Isolated cache consumer with the same opaque-version namespace as the
  // mounted truck-search route. No production search/database/provider calls.
  app.get('/search', cacheMiddleware(30, 'truck_search', async () => `v${await getTruckSearchVersion()}:user-one:query-one`), handler);
  return { app, handler, update: value => { result = value; } };
}
describe('booking cache invalidation without clock collisions', () => {
  it('bypasses a cached search after a second invalidation in the same millisecond', async () => {
    const { app, handler, update } = searchApp();
    await invalidateBookingCaches();
    const first = await request(app).get('/search');
    expect(first.headers['x-cache']).toBe('MISS');
    expect((await request(app).get('/search')).headers['x-cache']).toBe('HIT');
    update('truck-booked');
    await invalidateBookingCaches();
    const refreshed = await request(app).get('/search');
    expect(refreshed.headers['x-cache']).toBe('MISS');
    expect(refreshed.body.result).toBe('truck-booked');
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it('does not resurrect a previous cache namespace when the clock returns to an earlier time', async () => {
    await invalidateBookingCaches(); const first = await getTruckSearchVersion();
    vi.setSystemTime(new Date('2026-01-01T11:00:00Z'));
    await invalidateBookingCaches(); const second = await getTruckSearchVersion();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    await invalidateBookingCaches(); const third = await getTruckSearchVersion();
    expect(new Set([first, second, third]).size).toBe(3);
  });
  it('publishes distinct versions for simultaneous invalidation requests', async () => {
    await Promise.all([invalidateBookingCaches(), invalidateBookingCaches(), invalidateBookingCaches()]);
    const versions = redis.set.mock.calls.filter(([key]) => key === 'version:truck_search').map(([, version]) => version);
    expect(new Set(versions).size).toBe(3);
    expect(await getTruckSearchVersion()).toBe(versions.at(-1));
  });
  it('preserves the default namespace before the first successful invalidation', async () => {
    expect(await getTruckSearchVersion()).toBe('1');
    await invalidateBookingCaches();
    expect(await getTruckSearchVersion()).not.toBe('1');
  });
  it('keeps outage handling and does not claim a new version after a failed write', async () => {
    redis.set.mockRejectedValueOnce(new Error('offline'));
    await expect(invalidateBookingCaches()).resolves.toBeUndefined();
    expect(await getTruckSearchVersion()).toBe('1');
    redis.get.mockRejectedValueOnce(new Error('offline'));
    expect(await getTruckSearchVersion()).toBe('1');
  });
});
