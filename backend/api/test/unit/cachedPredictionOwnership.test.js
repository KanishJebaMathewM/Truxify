import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const priceInput = { distanceKm: 100, cargoWeightKg: 1000, trafficMultiplier: 2 };
const priceOutput = { estimated_price: 1000, min_price: 850, max_price: 1150,
  currency: 'INR', confidence: 0.8 };
function response(value, status = 200) {
  return { ok: status === 200, status, text: async () => JSON.stringify(value) };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

let ml;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('ML_API_KEY', 'test-only');
  vi.stubEnv('ML_ENGINE_URL', 'http://ml.invalid');
  ml = await import('../../src/services/ml.js');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('actual cached prediction native ownership', () => {
  it.each(['demand', 'price'])('coalesces four identical cold %s calls through native work', async kind => {
    const provider = deferred();
    const fetch = vi.fn(() => provider.promise);
    vi.stubGlobal('fetch', fetch);
    const invoke = () => kind === 'demand' ? ml.predictDemand({ region: 'Delhi' }) : ml.predictPrice(priceInput);
    const pending = Array.from({ length: 4 }, invoke);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    provider.resolve(response(kind === 'price' ? priceOutput : { predicted_demand: 42 }));
    const values = await Promise.all(pending);
    expect(values.every(value => value === values[0])).toBe(true);
    if (kind === 'price') expect(values[0]).toMatchObject({ estimatedPricePaisa: 200000,
      estimatedPriceInr: 2000, min_price: 1700, max_price: 2300 });
    await invoke();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps ownership after headers resolve while response body is pending', async () => {
    const body = deferred();
    const text = vi.fn(() => body.promise);
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text }));
    vi.stubGlobal('fetch', fetch);
    const first = ml.predictDemand({ region: 'Delhi' });
    await flush();
    const second = ml.predictDemand({ region: 'Delhi' });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledTimes(1);
    body.resolve('{"predicted_demand":42}');
    expect(await first).toEqual(await second);
  });

  it('shares eight native slots across price/demand but joins an existing flight at capacity', async () => {
    const provider = deferred();
    const fetch = vi.fn(async url => {
      await provider.promise;
      return response(url.endsWith('/price') ? priceOutput : { predicted_demand: 42 });
    });
    vi.stubGlobal('fetch', fetch);
    const demand = Array.from({ length: 4 }, (_, index) => ml.predictDemand({ index }));
    const prices = Array.from({ length: 4 }, (_, index) => ml.predictPrice({ ...priceInput, distanceKm: 100 + index }));
    await flush();
    const joined = ml.predictDemand({ index: 0 });
    await expect(ml.predictDemand({ index: 99 })).rejects.toThrow('Prediction capacity reached');
    expect(fetch).toHaveBeenCalledTimes(8);
    provider.resolve();
    await Promise.all([...demand, ...prices, joined]);
    await ml.predictDemand({ index: 99 });
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it.each(['fetch', 'body'])('deadline aborts callers but retains all native %s owners until settlement', async phase => {
    const pending = deferred();
    const signals = [];
    const fetch = vi.fn(async (url, options) => {
      signals.push(options.signal);
      if (phase === 'fetch') await pending.promise;
      return { ok: true, status: 200, text: async () => {
        if (phase === 'body') await pending.promise;
        return '{"predicted_demand":42}';
      } };
    });
    vi.stubGlobal('fetch', fetch);
    const owners = Array.from({ length: 8 }, (_, index) => ml.predictDemand({ index }));
    const outcomes = Promise.allSettled(owners);
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await outcomes).every(result => result.status === 'rejected')).toBe(true);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await expect(ml.predictDemand({ index: 99 })).rejects.toThrow('Prediction capacity reached');
    await expect(ml.predictDemand({ index: 0 })).rejects.toThrow('deadline exceeded');
    expect(fetch).toHaveBeenCalledTimes(8);
    pending.resolve();
    await flush();
    await ml.predictDemand({ index: 0 });
    expect(fetch).toHaveBeenCalledTimes(9); // old expired result never entered the cache
    await ml.predictDemand({ index: 0 });
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it.each(['network', 'body', 'json', 'http', 'validation'])('releases %s failures without caching and retries successfully', async failure => {
    const fetch = vi.fn(async () => {
      if (failure === 'network') throw new Error('offline');
      if (failure === 'body') return { ok: true, status: 200, text: async () => { throw new Error('body failed'); } };
      if (failure === 'json') return { ok: true, status: 200, text: async () => 'invalid JSON' };
      if (failure === 'http') return response({ error: 'unavailable' }, 503);
      return response({ ...priceOutput, estimated_price: -1 });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await Promise.allSettled([ml.predictPrice(priceInput), ml.predictPrice(priceInput)]);
    expect(result.every(item => item.status === 'rejected')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => response(priceOutput));
    expect(await ml.predictPrice(priceInput)).toMatchObject({ estimatedPricePaisa: 200000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('captures payload/headers before deferred dispatch and separates distinct configured endpoints', async () => {
    const gate = deferred();
    const fetch = vi.fn(async () => { await gate.promise; return response({ predicted_demand: 42 }); });
    vi.stubGlobal('fetch', fetch);
    const features = { region: 'original' };
    const first = ml.predictDemand(features);
    features.region = 'mutated';
    vi.stubEnv('ML_ENGINE_URL', 'http://other.invalid');
    const second = ml.predictDemand({ region: 'original' });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('http://ml.invalid/predict/demand');
    expect(fetch.mock.calls[0][1].body).toBe('{"region":"original"}');
    expect(fetch.mock.calls[1][0]).toBe('http://other.invalid/predict/demand');
    gate.resolve();
    await Promise.all([first, second]);
  });

  it('retains the existing fifteen-minute demand cache TTL', async () => {
    const fetch = vi.fn(async () => response({ predicted_demand: 42 }));
    vi.stubGlobal('fetch', fetch);
    await ml.predictDemand({ region: 'Delhi' });
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await ml.predictDemand({ region: 'Delhi' });
    expect(fetch).toHaveBeenCalledTimes(1); // original inclusive expiry boundary
    await vi.advanceTimersByTimeAsync(1);
    await ml.predictDemand({ region: 'Delhi' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains the existing hundred-entry demand cache bound', async () => {
    const fetch = vi.fn(async () => response({ predicted_demand: 42 }));
    vi.stubGlobal('fetch', fetch);
    for (let index = 0; index < 101; index++) await ml.predictDemand({ index });
    await ml.predictDemand({ index: 100 });
    expect(fetch).toHaveBeenCalledTimes(101);
    await ml.predictDemand({ index: 0 });
    expect(fetch).toHaveBeenCalledTimes(102);
  });

  it('preserves the missing-key guard and makes no provider call', async () => {
    vi.stubEnv('ML_API_KEY', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(ml.predictDemand({})).rejects.toThrow('not configured');
    await expect(ml.predictPrice(priceInput)).rejects.toThrow('not configured');
    expect(fetch).not.toHaveBeenCalled();
  });
});
