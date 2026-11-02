import http from 'node:http';
import { once } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const state = vi.hoisted(() => ({ redis: { get: vi.fn(), set: vi.fn() }, breakers: [] }));
vi.mock('opossum', async importOriginal => {
  const { default: RealBreaker } = await importOriginal();
  return { default: class extends RealBreaker {
    constructor(...args) { super(...args); state.breakers.push(this); }
  } };
});
vi.mock('../../src/config/db.js', () => ({ redisClient: state.redis }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const input = { pickupLat: 12, pickupLng: 77, dropLat: 13, dropLng: 78 };
const geoInput = { originLat: 12, originLng: 77, destLat: 13, destLng: 78 };
const payload = { routes: [{ distance: 2000, duration: 60, geometry: { coordinates: [[77, 12], [78, 13]] } }] };
let module;
let timers = false;
let server;
const nativeFetch = globalThis.fetch;
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const response = (overrides = {}) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(payload), ...overrides });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('OSRM_TOTAL_TIMEOUT_MS', '100');
  vi.stubEnv('OSRM_CACHE_TIMEOUT_MS', '10');
  vi.stubEnv('OSRM_TIMEOUT_MS', '80');
  vi.stubEnv('OSRM_MAX_RETRIES', '1');
  state.redis.get.mockReset().mockResolvedValue(null);
  state.redis.set.mockReset().mockResolvedValue('OK');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  module = await import('../../src/services/osrm.js');
});
afterEach(async () => {
  for (const breaker of state.breakers.splice(0)) breaker.shutdown();
  if (timers) { vi.useRealTimers(); timers = false; }
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); server = null; }
});
function fakeClock() { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); timers = true; }
async function advance(ms) { await vi.advanceTimersByTimeAsync(ms); }

for (const kind of ['estimate', 'geometry']) {
  const call = () => kind === 'estimate' ? module.getRouteEstimate(input) : module.getRouteGeometry(geoInput);
  describe(`${kind} owned caller budget`, () => {
    it('a stalled cache read is advisory and cannot block the provider', async () => {
      fakeClock(); state.redis.get.mockReturnValue(deferred().promise);
      const result = call(); await advance(11);
      expect(await result).not.toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
    it('a stalled cache write cannot hold a completed result', async () => {
      fakeClock(); state.redis.set.mockReturnValue(deferred().promise);
      const result = call(); await advance(11);
      expect(await result).not.toBeNull(); expect(vi.getTimerCount()).toBe(0);
    });
    it('late cache completion cannot dispatch a provider after caller expiry', async () => {
      fakeClock(); vi.stubEnv('OSRM_CACHE_TIMEOUT_MS', '500');
      const cache = deferred(); state.redis.get.mockReturnValue(cache.promise);
      const result = call(); await advance(101); expect(await result).toBeNull();
      cache.resolve(null); await advance(1); expect(fetch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
    it('an abort-ignoring response body cannot extend caller completion or write cache later', async () => {
      fakeClock(); const body = deferred(); fetch.mockResolvedValue(response({ json: () => body.promise }));
      const result = call(); await advance(101); expect(await result).toBeNull();
      body.resolve(payload); await advance(1); expect(state.redis.set).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it('cache hit/result shape and TTL remain compatible', async () => {
      const expected = kind === 'estimate' ? { distanceKm: 2, durationSeconds: 60 } : { type: 'Feature', properties: { distanceKm: 2, durationSeconds: 60 }, geometry: { type: 'LineString', coordinates: [[77, 12], [78, 13]] } };
      state.redis.get.mockResolvedValueOnce(JSON.stringify(expected));
      expect(await call()).toEqual(expected); expect(fetch).not.toHaveBeenCalled();
      state.redis.get.mockResolvedValue(null);
      expect(await call()).toEqual(expected);
      expect(state.redis.set).toHaveBeenCalledWith(expect.any(String), JSON.stringify(expected), 'EX', kind === 'estimate' ? 86400 : 30);
    });
    it('native unfinished 404 response resolves and closes the HTTP exchange', async () => {
      vi.stubGlobal('fetch', nativeFetch); vi.stubEnv('OSRM_TIMEOUT_MS', '30');
      const closed = deferred();
      server = http.createServer((_req, res) => { res.on('close', closed.resolve); res.writeHead(404); res.write('unfinished'); });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      vi.stubEnv('OSRM_BASE_URL', `http://127.0.0.1:${server.address().port}`);
      expect(await call()).toBeNull();
      await Promise.race([closed.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('HTTP exchange still open')), 500))]);
    });
    it('native unfinished JSON body resolves and closes the HTTP exchange', async () => {
      vi.stubGlobal('fetch', nativeFetch); vi.stubEnv('OSRM_TIMEOUT_MS', '30');
      const closed = deferred();
      server = http.createServer((_req, res) => { res.on('close', closed.resolve); res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"routes":['); });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      vi.stubEnv('OSRM_BASE_URL', `http://127.0.0.1:${server.address().port}`);
      expect(await call()).toBeNull();
      await Promise.race([closed.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('HTTP exchange still open')), 500))]);
    });
  });
}

describe('estimate retry budget ownership', () => {
  it('does not wait or dispatch a retry whose backoff exceeds the remaining budget', async () => {
    fakeClock(); vi.stubEnv('OSRM_MAX_RETRIES', '10'); vi.stubEnv('OSRM_RETRY_BASE_DELAY_MS', '200');
    fetch.mockRejectedValue(new Error('fixture unavailable'));
    const result = module.getRouteEstimate(input); await advance(1);
    expect(await result).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
    for (const breaker of state.breakers) breaker.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('allows a successful transient retry that fits the shared budget', async () => {
    // Warm actual breaker statistics: a lone failure opens the real breaker,
    // which intentionally suppresses retry regardless of remaining time.
    await module.getRouteEstimate(input); await module.getRouteEstimate(input);
    fetch.mockClear();
    fakeClock(); vi.stubEnv('OSRM_MAX_RETRIES', '2'); vi.stubEnv('OSRM_RETRY_BASE_DELAY_MS', '10');
    fetch.mockRejectedValueOnce(new Error('fixture transient')).mockResolvedValue(response());
    const result = module.getRouteEstimate(input); await advance(11);
    expect(await result).toEqual({ distanceKm: 2, durationSeconds: 60 }); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('monotonic budget lifecycle primitives', () => {
  it('normalizes invalid durations and clamps explicit upper bounds', async () => {
    const { boundedMilliseconds } = await import('../../src/services/routing/routingBudget.js');
    for (const value of [undefined, '', 0, -1, NaN, Infinity, 'invalid']) {
      expect(boundedMilliseconds(value, 100, 1000)).toBe(100);
    }
    expect(boundedMilliseconds('2000', 100, 1000)).toBe(1000);
    expect(boundedMilliseconds(0.2, 100, 1000)).toBe(1);
    expect(boundedMilliseconds('12.9', 100, 1000)).toBe(12);
  });
  it('a monotonic expiry check suppresses a late result even before a timer callback executes', async () => {
    fakeClock();
    const { RoutingBudget } = await import('../../src/services/routing/routingBudget.js');
    const budget = new RoutingBudget(100);
    const result = budget.wait(() => { vi.spyOn(performance, 'now').mockReturnValue(200); return 'late'; });
    await expect(result).rejects.toMatchObject({ code: 'E_OSRM_BUDGET' });
    budget.dispose(); vi.restoreAllMocks(); expect(vi.getTimerCount()).toBe(0);
  });
  it('caller expiry clears an unfinished retry timer and prevents later work', async () => {
    fakeClock();
    const { RoutingBudget } = await import('../../src/services/routing/routingBudget.js');
    const budget = new RoutingBudget(100);
    const wait = budget.delay(80);
    const rejection = expect(wait).rejects.toMatchObject({ code: 'E_OSRM_BUDGET' });
    await advance(1); budget.expire(); await rejection;
    budget.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('a late rejected cache command is observed without continuing provider work', async () => {
    fakeClock(); vi.stubEnv('OSRM_CACHE_TIMEOUT_MS', '500');
    const cache = deferred(); state.redis.get.mockReturnValue(cache.promise);
    const result = module.getRouteEstimate(input); await advance(101); expect(await result).toBeNull();
    cache.reject(new Error('late cache error')); await advance(1);
    expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});


describe('breaker timeout transport ownership', () => {
  it('aborts a breaker-timed-out attempt before waiting for a retry', async () => {
    await module.getRouteEstimate(input); await module.getRouteEstimate(input);
    fetch.mockClear(); fakeClock();
    vi.stubEnv('OSRM_TOTAL_TIMEOUT_MS', '8000'); vi.stubEnv('OSRM_TIMEOUT_MS', '10000');
    vi.stubEnv('OSRM_MAX_RETRIES', '2'); vi.stubEnv('OSRM_RETRY_BASE_DELAY_MS', '10');
    let firstSignal;
    fetch.mockImplementationOnce((_url, options) => { firstSignal = options.signal; return deferred().promise; }).mockResolvedValue(response());
    const result = module.getRouteEstimate(input); await advance(5001);
    expect(firstSignal.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
    await advance(20); expect(await result).toEqual({ distanceKm: 2, durationSeconds: 60 });
    expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
