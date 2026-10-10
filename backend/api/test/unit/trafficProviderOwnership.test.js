import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({ redisClient: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: {
  info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
} }));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const body = { flowSegmentData: { currentTravelTime: 1350, freeFlowTravelTime: 1000 } };
const route = { origin: [12, 77], destination: [13, 78] };
let service, redis;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('TOMTOM_API_KEY', 'test-key');
  vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn());
  service = await import('../../src/services/trafficService.js');
  redis = (await import('../../src/config/db.js')).redisClient;
  redis.get.mockReset().mockResolvedValue(null);
  redis.set.mockReset().mockResolvedValue('OK');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function flush() { await vi.advanceTimersByTimeAsync(0); }
function response(data = body) { return { ok: true, json: vi.fn().mockResolvedValue(data) }; }

describe('actual traffic provider ownership', () => {
  it('coalesces twelve identical point calls through the pending response body', async () => {
    const pending = deferred();
    fetch.mockResolvedValue({ ok: true, json: () => pending.promise });
    const calls = Array.from({ length: 12 }, () => service.getLiveTrafficMultiplier(12, 77));
    await flush();
    const count = fetch.mock.calls.length;
    pending.resolve(body);
    expect(await Promise.all(calls)).toEqual(Array(12).fill(1.35));
    expect(count).toBe(1);
  });
  it('coalesces point and route requests when the exact TomTom URL agrees', async () => {
    const pending = deferred();
    fetch.mockReturnValue(pending.promise);
    const point = service.getLiveTrafficMultiplier(12, 77);
    const routed = service.getTrafficForRoute(route);
    await flush();
    const count = fetch.mock.calls.length;
    pending.resolve(response());
    expect(await point).toBe(1.35);
    expect(await routed).toMatchObject({ multiplier: 1.35, delayMinutes: 6 });
    expect(count).toBe(1);
  });
  it('shares provider work for concurrent enterprise cache misses', async () => {
    const pending = deferred();
    fetch.mockResolvedValue({ ok: true, json: () => pending.promise });
    const calls = Array.from({ length: 4 }, () => service.getLiveTrafficMultiplierEnterprise(12, 77));
    await flush();
    const count = fetch.mock.calls.length;
    pending.resolve(body);
    expect(await Promise.all(calls)).toEqual(Array(4).fill(1.35));
    expect(count).toBe(1);
    expect(redis.set).toHaveBeenCalledWith('traffic_ent:12.000,77.000', '1.35', 'EX', 300);
  });
  for (const mode of ['headers', 'body']) {
    it(`retains all eight ${mode} owners after deadline while callers fall back`, async () => {
      const pending = Array.from({ length: 8 }, deferred);
      let started = 0;
      fetch.mockImplementation(() => mode === 'headers'
        ? pending[started++].promise
        : Promise.resolve({ ok: true, json: () => pending[started++].promise }));
      const calls = Array.from({ length: 8 }, (_, i) => service.getLiveTrafficMultiplier(i, 77));
      await flush();
      expect(fetch).toHaveBeenCalledTimes(8);
      expect(await service.getLiveTrafficMultiplier(20, 77)).toBe(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await Promise.all(calls)).toEqual(Array(8).fill(1));
      for (const [, options] of fetch.mock.calls) expect(options.signal.aborted).toBe(true);
      expect(await service.getLiveTrafficMultiplier(20, 77)).toBe(1);
      expect(await service.getLiveTrafficMultiplier(0, 77)).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(8);
      for (const item of pending) item.resolve(mode === 'headers' ? response() : body);
      await flush();
      fetch.mockResolvedValue(response());
      expect(await service.getLiveTrafficMultiplier(20, 77)).toBe(1.35);
      expect(fetch).toHaveBeenCalledTimes(9);
    });
  }
  it('shares the eight-slot cap across point and route Google operations', async () => {
    vi.stubEnv('TOMTOM_API_KEY', ''); vi.stubEnv('GOOGLE_MAPS_API_KEY', 'google-test');
    const pending = deferred(); fetch.mockReturnValue(pending.promise);
    const points = Array.from({ length: 4 }, (_, i) => service.getLiveTrafficMultiplier(i, 77));
    const routes = Array.from({ length: 4 }, (_, i) => service.getTrafficForRoute({ origin: [i + 20, 77], destination: [30, 78] }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(await service.getLiveTrafficMultiplier(40, 77)).toBe(1);
    expect(await service.getTrafficForRoute({ origin: [41, 77], destination: [42, 78] })).toMatchObject({ fallback: true });
    expect(fetch).toHaveBeenCalledTimes(8);
    pending.resolve(response({ rows: [{ elements: [{ duration_in_traffic: { value: 1500 }, duration: { value: 1000 } }] }] }));
    expect(await Promise.all(points)).toEqual(Array(4).fill(1.5));
    for (const result of await Promise.all(routes)) expect(result.multiplier).toBe(1.5);
  });
  it('observes late body rejection and permits retry only after settlement', async () => {
    const pending = deferred();
    fetch.mockResolvedValue({ ok: true, json: () => pending.promise });
    const call = service.getLiveTrafficMultiplier(12, 77);
    await flush(); await vi.advanceTimersByTimeAsync(5000);
    expect(await call).toBe(1);
    pending.reject(new Error('late body failure'));
    await flush();
    fetch.mockResolvedValue(response());
    expect(await service.getLiveTrafficMultiplier(12, 77)).toBe(1.35);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('returns route heuristic on body deadline without publishing a late route cache result', async () => {
    const pending = deferred();
    fetch.mockResolvedValue({ ok: true, json: () => pending.promise });
    const call = service.getTrafficForRoute(route);
    await flush(); await vi.advanceTimersByTimeAsync(5000);
    expect(await call).toMatchObject({ fallback: true, delayMinutes: 0 });
    pending.resolve(body); await flush();
    expect(redis.set).not.toHaveBeenCalled();
  });
  it('holds admission while an unused HTTP error body is being cancelled', async () => {
    const pending = deferred();
    const cancel = vi.fn(() => pending.promise);
    fetch.mockResolvedValue({ ok: false, status: 503, body: { cancel } });
    const first = service.getLiveTrafficMultiplier(12, 77);
    await flush();
    const second = service.getLiveTrafficMultiplier(12, 77);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    pending.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 1]);
  });
  it('keeps captured provider keys separate during configuration changes', async () => {
    const pending = deferred();
    fetch.mockReturnValue(pending.promise);
    const first = service.getLiveTrafficMultiplier(12, 77);
    vi.stubEnv('TOMTOM_API_KEY', 'other-test-key');
    const second = service.getLiveTrafficMultiplier(12, 77);
    await flush(); const urls = fetch.mock.calls.map(([url]) => url);
    pending.resolve(response()); await Promise.all([first, second]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('key=test-key'); expect(urls[1]).toContain('key=other-test-key');
  });
  it('does not merge nearby but unequal coordinates', async () => {
    const pending = deferred(); fetch.mockReturnValue(pending.promise);
    const calls = [service.getLiveTrafficMultiplier(12.0001, 77), service.getLiveTrafficMultiplier(12.0002, 77)];
    await flush(); const count = fetch.mock.calls.length;
    pending.resolve(response()); await Promise.all(calls); expect(count).toBe(2);
  });
  it('keeps Google destination requests distinct and preserves duration arithmetic', async () => {
    vi.stubEnv('TOMTOM_API_KEY', ''); vi.stubEnv('GOOGLE_MAPS_API_KEY', 'google-test');
    const pending = deferred(); fetch.mockReturnValue(pending.promise);
    const first = service.getLiveTrafficMultiplier(12, 77);
    const second = service.getTrafficForRoute(route);
    await flush(); const count = fetch.mock.calls.length;
    pending.resolve(response({ rows: [{ elements: [{ duration_in_traffic: { value: 2000 }, duration: { value: 1000 } }] }] }));
    expect(await first).toBe(2); expect(await second).toMatchObject({ multiplier: 2, delayMinutes: 17, congestionLevel: 'heavy' });
    expect(count).toBe(2);
  });
  for (const failure of ['http', 'json', 'network']) {
    it(`coalesces ${failure} failure, preserves baseline fallback and retries`, async () => {
      const pending = deferred(); fetch.mockReturnValue(pending.promise);
      const calls = [service.getLiveTrafficMultiplier(12, 77), service.getLiveTrafficMultiplier(12, 77)];
      await flush(); const count = fetch.mock.calls.length;
      if (failure === 'network') pending.reject(new Error('network'));
      else pending.resolve(failure === 'http' ? { ok: false, status: 503 } : { ok: true, json: () => Promise.reject(new Error('json')) });
      expect(await Promise.all(calls)).toEqual([1, 1]); expect(count).toBe(1);
      fetch.mockResolvedValue(response()); expect(await service.getLiveTrafficMultiplier(12, 77)).toBe(1.35);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  }
  it('preserves Redis route and enterprise hits without starting provider work', async () => {
    redis.get.mockResolvedValueOnce('1.75').mockResolvedValueOnce(JSON.stringify({ multiplier: 1.8, success: true }));
    expect(await service.getLiveTrafficMultiplierEnterprise(12, 77)).toBe(1.75);
    expect(await service.getTrafficForRoute(route)).toMatchObject({ multiplier: 1.8, cached: true });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps skipCache bypass while sharing identical native provider work', async () => {
    const pending = deferred(); fetch.mockReturnValue(pending.promise);
    const calls = [service.getTrafficForRoute(route, { skipCache: true }), service.getTrafficForRoute(route, { skipCache: true })];
    await flush(); const count = fetch.mock.calls.length;
    pending.resolve(response()); await Promise.all(calls);
    expect(count).toBe(1); expect(redis.get).not.toHaveBeenCalled(); expect(redis.set).not.toHaveBeenCalled();
  });
  it('preserves no-key baseline and invalid-input guards', async () => {
    vi.stubEnv('TOMTOM_API_KEY', '');
    expect(await service.getLiveTrafficMultiplier(12, 77)).toBe(1);
    expect(await service.getLiveTrafficMultiplier(null, 77)).toBe(1);
    expect(await service.getLiveTrafficMultiplier(NaN, 77)).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
