import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('ethers', () => ({ ethers: { JsonRpcProvider: class {
  constructor(url) { this.url = url; }
} } }));
import { RpcProviderManager, CIRCUIT_STATES as states } from '../../src/services/blockchain/rpcProviderManager.js';

let now;
beforeEach(() => {
  now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => vi.restoreAllMocks());
const manager = (options = {}) => new RpcProviderManager({
  rpcUrls: ['primary', 'fallback'], failureThreshold: 1, cooldownMs: 100, ...options,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const begin = (m) => {
  const work = deferred();
  const fn = vi.fn(() => work.promise);
  const result = m.executeWithRetry(fn, { maxRetries: 0 });
  return { ...work, fn, result };
};
const open = (m) => m.recordFailure();
const cooldown = () => { now += 101; };

describe('actual manager recovery feedback and callback ownership', () => {
  it('does not close a pending primary probe on a late fallback success', async () => {
    const m = manager(); open(m);
    const fallback = begin(m); cooldown(); const probe = begin(m);
    fallback.resolve('fallback'); await fallback.result;
    expect(m.state).toBe(states.HALF_OPEN);
    expect(probe.fn.mock.calls[0][0].url).toBe('primary');
    probe.resolve('recovered'); await probe.result;
    expect(m.state).toBe(states.CLOSED);
  });
  it('does not reopen a pending primary probe on a late fallback failure', async () => {
    const m = manager(); open(m);
    const fallback = begin(m); const handled = fallback.result.catch((e) => e);
    cooldown(); const probe = begin(m);
    const failure = new Error('fallback down'); fallback.reject(failure);
    expect(await handled).toBe(failure);
    expect(m.state).toBe(states.HALF_OPEN);
    probe.resolve('recovered'); await probe.result;
  });
  it('admits one native primary recovery callback for twenty concurrent callers', async () => {
    const m = manager(); open(m); cooldown();
    const calls = Array.from({ length: 20 }, () => begin(m));
    expect(calls.filter((call) => call.fn.mock.calls[0][0].url === 'primary')).toHaveLength(1);
    expect(calls.filter((call) => call.fn.mock.calls[0][0].url === 'fallback')).toHaveLength(19);
    // Secondary callbacks settle while the primary is still physically pending.
    calls.slice(1).forEach((call) => call.resolve('fallback'));
    await Promise.all(calls.slice(1).map((call) => call.result));
    expect(m.state).toBe(states.HALF_OPEN);
    calls[0].resolve('primary'); await calls[0].result;
    expect(m.state).toBe(states.CLOSED);
  });
  it('ignores a pre-open primary success after a newer recovery has begun', async () => {
    const m = manager(); const old = begin(m); open(m); cooldown(); const probe = begin(m);
    old.resolve('old primary'); await old.result;
    expect(m.state).toBe(states.HALF_OPEN);
    probe.resolve('new primary'); await probe.result;
  });
  it('ignores a pre-open primary failure after a newer recovery succeeds', async () => {
    const m = manager(); const old = begin(m); const handled = old.result.catch((e) => e);
    open(m); cooldown(); await m.executeWithRetry(() => 'new primary', { maxRetries: 0 });
    const failure = new Error('old primary'); old.reject(failure);
    expect(await handled).toBe(failure);
    expect(m.state).toBe(states.CLOSED);
    expect(m.consecutiveFailures).toBe(0);
  });
  it('holds an old probe owner through a manual state change until actual settlement', async () => {
    const m = manager(); open(m); cooldown(); const oldProbe = begin(m);
    m.recordFailure(); cooldown(); const other = begin(m);
    expect(other.fn.mock.calls[0][0].url).toBe('fallback');
    other.resolve('fallback'); await other.result;
    oldProbe.resolve('stale recovery'); await oldProbe.result;
    expect(m.state).toBe(states.HALF_OPEN);
    const fresh = begin(m);
    expect(fresh.fn.mock.calls[0][0].url).toBe('primary');
    fresh.resolve('fresh'); await fresh.result;
    expect(m.state).toBe(states.CLOSED);
  });
  it('does not apply stale probe rejection to a manually closed newer generation', async () => {
    const m = manager(); open(m); cooldown(); const probe = begin(m);
    const handled = probe.result.catch((e) => e);
    m.recordSuccess(); const failure = new Error('stale probe'); probe.reject(failure);
    expect(await handled).toBe(failure);
    expect(m.state).toBe(states.CLOSED);
  });
  it('preserves consecutive failure threshold for normal primary calls', async () => {
    const m = manager({ failureThreshold: 2 });
    const fail = () => { throw new Error('down'); };
    await expect(m.executeWithRetry(fail, { maxRetries: 0 })).rejects.toThrow('down');
    expect(m.state).toBe(states.CLOSED);
    await expect(m.executeWithRetry(fail, { maxRetries: 0 })).rejects.toThrow('down');
    expect(m.state).toBe(states.OPEN);
  });
  it('closes on its owning primary recovery success', async () => {
    const m = manager(); open(m); cooldown();
    const value = { receipt: 'controlled' };
    expect(await m.executeWithRetry(() => value, { maxRetries: 0 })).toBe(value);
    expect(m.state).toBe(states.CLOSED);
    expect(m.consecutiveFailures).toBe(0);
  });
  it('reopens on its owning primary rejection and releases ownership for later recovery', async () => {
    const m = manager(); open(m); cooldown(); const probe = begin(m);
    const handled = probe.result.catch((e) => e); const failure = new Error('down');
    probe.reject(failure); expect(await handled).toBe(failure);
    expect(m.state).toBe(states.OPEN);
    expect(m.lastStateChangeTime).toBe(now);
    cooldown(); const next = begin(m);
    expect(next.fn.mock.calls[0][0].url).toBe('primary');
    next.resolve('up'); await next.result;
    expect(m.state).toBe(states.CLOSED);
  });
  it('cleans up a synchronously throwing recovery callback', async () => {
    const m = manager(); open(m); cooldown(); const failure = new Error('sync');
    await expect(m.executeWithRetry(() => { throw failure; }, { maxRetries: 0 })).rejects.toBe(failure);
    cooldown(); expect(await m.executeWithRetry(() => 'next', { maxRetries: 0 })).toBe('next');
    expect(m.state).toBe(states.CLOSED);
  });
  it('does not launch a second pending probe when no fallback is configured', async () => {
    const m = manager({ rpcUrls: ['primary'] }); open(m); cooldown(); const probe = begin(m);
    const second = vi.fn(() => 'unexpected');
    await expect(m.executeWithRetry(second, { maxRetries: 0 })).rejects.toThrow(/recovery probe.*progress/i);
    expect(second).not.toHaveBeenCalled();
    expect(m.state).toBe(states.HALF_OPEN);
    probe.resolve('up'); await probe.result;
    expect(await m.executeWithRetry(() => 'ordinary', { maxRetries: 0 })).toBe('ordinary');
  });
  it('preserves retry count/backoff and selects fallback after the first failure', async () => {
    const m = manager(); const failure = new Error('native failure');
    const fn = vi.fn(() => { throw failure; });
    await expect(m.executeWithRetry(fn, { maxRetries: 2, initialDelayMs: 1 })).rejects.toBe(failure);
    expect(fn.mock.calls.map(([provider]) => provider.url)).toEqual(['primary', 'fallback', 'fallback']);
    expect(m.state).toBe(states.OPEN);
  });
  it('returns the exact callback result and throws the original error with no retries', async () => {
    const m = manager(); const value = {};
    expect(await m.executeWithRetry(() => value, { maxRetries: 0 })).toBe(value);
    const failure = new Error('original');
    await expect(m.executeWithRetry(() => Promise.reject(failure), { maxRetries: 0 })).rejects.toBe(failure);
  });
  it('does not clear primary failure history on an ordinary fallback success', async () => {
    const m = manager(); open(m); const count = m.consecutiveFailures;
    await m.executeWithRetry(() => 'fallback', { maxRetries: 0 });
    expect(m.consecutiveFailures).toBe(count);
    expect(m.state).toBe(states.OPEN);
  });
  it('does not add primary failures for an ordinary fallback rejection', async () => {
    const m = manager(); open(m); const count = m.consecutiveFailures;
    await expect(m.executeWithRetry(() => Promise.reject(new Error('fallback')), { maxRetries: 0 })).rejects.toThrow('fallback');
    expect(m.consecutiveFailures).toBe(count);
    expect(m.state).toBe(states.OPEN);
  });
  it('does not serialize healthy normal-primary callbacks', async () => {
    const m = manager(); const calls = Array.from({ length: 20 }, () => begin(m));
    expect(calls.every((call) => call.fn.mock.calls[0][0].url === 'primary')).toBe(true);
    calls.forEach((call, i) => call.resolve(i));
    expect(await Promise.all(calls.map((call) => call.result))).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(m.state).toBe(states.CLOSED);
  });
  it('ignores a late fallback rejection after the primary has recovered', async () => {
    const m = manager(); open(m); const fallback = begin(m);
    const handled = fallback.result.catch((e) => e); cooldown();
    await m.executeWithRetry(() => 'up', { maxRetries: 0 });
    const failure = new Error('late fallback'); fallback.reject(failure);
    expect(await handled).toBe(failure);
    expect(m.state).toBe(states.CLOSED);
    expect(m.consecutiveFailures).toBe(0);
  });
});
