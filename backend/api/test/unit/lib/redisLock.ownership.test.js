/**
 * Behavioural regression tests for acquireDistributedLock ownership fencing
 * and lease keep-alive, run against a stateful in-memory Redis stand-in that
 * implements the same owner-checked GET/DEL and GET/PEXPIRE Lua semantics as
 * the real server.
 *
 * Original defects covered here:
 *   1. Every holder stored the constant '1' and released with a bare DEL, so a
 *      holder whose lease had expired could delete its *successor's* lock and
 *      let a third caller into the critical section.
 *   2. Critical sections that outlive the lease (e.g. the gasless relayer's
 *      30s on-chain confirmation wait vs. a 15s lock TTL) had no renewal.
 *   3. The in-process fallback armed its TTL timer at enqueue time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeRedis {
  constructor() {
    this.status = 'ready';
    this.store = new Map(); // key -> { val, exp|null }
    this.renewCalls = 0;
    this.failNextEvals = 0;
  }

  alive(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.exp !== null && Date.now() >= entry.exp) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  /** Simulate the server expiring the key (TTL elapsed) without waiting. */
  expireNow(key) {
    this.store.delete(key);
  }

  async set(key, val, ...args) {
    let nx = false;
    let ttlMs = null;
    for (let i = 0; i < args.length; i++) {
      const flag = String(args[i]).toUpperCase();
      if (flag === 'NX') nx = true;
      else if (flag === 'EX') ttlMs = Number(args[++i]) * 1000;
      else if (flag === 'PX') ttlMs = Number(args[++i]);
    }
    if (nx && this.alive(key)) return null;
    this.store.set(key, { val, exp: ttlMs === null ? null : Date.now() + ttlMs });
    return 'OK';
  }

  async get(key) {
    return this.alive(key)?.val ?? null;
  }

  async eval(script, _numKeys, key, ...argv) {
    if (script.includes('PEXPIRE')) this.renewCalls++;
    if (this.failNextEvals > 0) {
      this.failNextEvals--;
      throw new Error('redis blip');
    }
    const entry = this.alive(key);
    if (script.includes('PEXPIRE')) {
      if (entry && entry.val === argv[0]) {
        entry.exp = Date.now() + Number(argv[1]);
        return 1;
      }
      return 0;
    }
    if (script.includes('DEL')) {
      if (entry && entry.val === argv[0]) {
        this.store.delete(key);
        return 1;
      }
      return 0;
    }
    throw new Error('unexpected script');
  }
}

async function loadRedisLock(redisClient) {
  vi.resetModules();
  vi.doMock('../../../src/config/db.js', () => ({ redisClient }));
  return import('../../../src/lib/redisLock.js');
}

describe('acquireDistributedLock ownership fencing', () => {
  let redis;
  let mod;

  beforeEach(async () => {
    redis = new FakeRedis();
    mod = await loadRedisLock(redis);
  });

  it("a stale holder's late release does not free the successor's lock", async () => {
    const holderA = await mod.acquireDistributedLock('lock:relayer:nonce', 15);
    expect(holderA.acquired).toBe(true);

    redis.expireNow('lock:relayer:nonce'); // A overran its lease; the server expired the key

    const holderB = await mod.acquireDistributedLock('lock:relayer:nonce', 15);
    expect(holderB.acquired).toBe(true);

    await expect(holderA.release()).resolves.toBe(false); // A is no longer the owner

    // B must still hold the lock: a third caller has to be refused.
    const holderC = await mod.acquireDistributedLock('lock:relayer:nonce', 15);
    expect(holderC.acquired).toBe(false);

    await expect(holderB.release()).resolves.toBe(true);
    const holderD = await mod.acquireDistributedLock('lock:relayer:nonce', 15);
    expect(holderD.acquired).toBe(true);
    await holderD.release();
  });

  it('removes the key on a normal release and refuses contenders until then', async () => {
    const holder = await mod.acquireDistributedLock('k', 5);
    expect(await redis.get('k')).toEqual(expect.any(String));
    expect((await mod.acquireDistributedLock('k', 5)).acquired).toBe(false);

    await expect(holder.release()).resolves.toBe(true);
    expect(await redis.get('k')).toBeNull();
  });
});

describe('acquireDistributedLock keepAlive (lease renewal)', () => {
  let redis;
  let mod;

  beforeEach(async () => {
    redis = new FakeRedis();
    mod = await loadRedisLock(redis);
  });

  it('renews the lease while the critical section runs, so contenders stay locked out', async () => {
    // 1s lease, but the critical section runs ~1.5s. Without keep-alive the key would
    // expire mid-flight and a contender could acquire it.
    const holder = await mod.acquireDistributedLock('k', 1, { keepAlive: true, renewIntervalMs: 50 });
    const contenders = [];
    for (let i = 0; i < 6; i++) {
      await sleep(250);
      const contender = await mod.acquireDistributedLock('k', 1);
      contenders.push(contender.acquired);
      if (contender.acquired) await contender.release();
    }

    expect(contenders).toEqual([false, false, false, false, false, false]);
    expect(redis.renewCalls).toBeGreaterThan(1);
    expect(holder.isLost()).toBe(false);

    await expect(holder.release()).resolves.toBe(true);
    expect((await mod.acquireDistributedLock('k', 1)).acquired).toBe(true);
  });

  it('stops renewing after release()', async () => {
    const holder = await mod.acquireDistributedLock('k', 5, { keepAlive: true, renewIntervalMs: 20 });
    await sleep(70);
    await holder.release();

    const callsAtRelease = redis.renewCalls;
    await sleep(100);
    expect(redis.renewCalls).toBe(callsAtRelease);
  });

  it('does not report a lost lock when release() races an in-flight renewal', async () => {
    const realEval = redis.eval.bind(redis);
    redis.eval = async (...args) => {
      await sleep(40); // slow Redis: the renewal is still in flight when release() runs
      return realEval(...args);
    };

    const holder = await mod.acquireDistributedLock('k', 5, { keepAlive: true, renewIntervalMs: 20 });
    await sleep(30); // a renewal is now in flight
    await holder.release();
    await sleep(120);

    expect(holder.isLost()).toBe(false);
  });

  it('reports the lock as lost and stops renewing once ownership is gone', async () => {
    const holder = await mod.acquireDistributedLock('k', 5, { keepAlive: true, renewIntervalMs: 20 });
    redis.store.set('k', { val: 'someone-else', exp: null }); // key now belongs to another holder

    await sleep(80);
    expect(holder.isLost()).toBe(true);

    const callsWhenLost = redis.renewCalls;
    await sleep(80);
    expect(redis.renewCalls).toBe(callsWhenLost); // loop stopped
    expect(redis.store.get('k').val).toBe('someone-else'); // never touched the new owner's key

    await expect(holder.release()).resolves.toBe(false);
  });

  it('survives a transient Redis error without marking the lock lost', async () => {
    const holder = await mod.acquireDistributedLock('k', 5, { keepAlive: true, renewIntervalMs: 20 });
    redis.failNextEvals = 2;

    await sleep(120);
    expect(holder.isLost()).toBe(false);
    expect(redis.renewCalls).toBeGreaterThan(2); // kept retrying after the blip
    await expect(holder.release()).resolves.toBe(true);
  });

  it('stops renewing at maxHoldMs so a hung holder cannot pin the lock forever', async () => {
    const holder = await mod.acquireDistributedLock('k', 5, {
      keepAlive: true,
      renewIntervalMs: 20,
      maxHoldMs: 80,
    });

    await sleep(200);
    const callsAfterCap = redis.renewCalls;
    await sleep(100);
    expect(redis.renewCalls).toBe(callsAfterCap);
    await holder.release();
  });

  it('does not renew at all unless keepAlive is requested', async () => {
    const holder = await mod.acquireDistributedLock('k', 5, { renewIntervalMs: 10 });
    await sleep(60);
    expect(redis.renewCalls).toBe(0);
    await holder.release();
  });

  it('withLock forwards the keepAlive options', async () => {
    await mod.withLock('k', () => sleep(80), { ttlSeconds: 5, keepAlive: true, renewIntervalMs: 10 });
    expect(redis.renewCalls).toBeGreaterThan(0);
    expect(await redis.get('k')).toBeNull(); // released afterwards
  });
});

describe('acquireDistributedLock in-process fallback (Redis unavailable)', () => {
  it('serialises callers and starts each lease when the lock is granted', async () => {
    const mod = await loadRedisLock(null);
    let inside = 0;
    let maxInside = 0;

    // 4 callers queue at once, each needs 70ms but only holds a 100ms lease. With the
    // old enqueue-time timer the 2nd..4th leases were already spent when granted.
    const worker = async () => {
      const lock = await mod.acquireDistributedLock('res', 0.1);
      inside++;
      maxInside = Math.max(maxInside, inside);
      await sleep(70);
      inside--;
      await lock.release();
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    expect(maxInside).toBe(1);
  });

  it('keepAlive extends the in-process lease past its TTL', async () => {
    const mod = await loadRedisLock(null);
    const holder = await mod.acquireDistributedLock('res-ka', 0.1, { keepAlive: true, renewIntervalMs: 20 });

    let contenderGranted = false;
    const contenderP = mod.acquireDistributedLock('res-ka', 1).then((lock) => {
      contenderGranted = true;
      return lock;
    });

    await sleep(300); // 3x the 100ms TTL
    expect(contenderGranted).toBe(false);
    expect(holder.isLost()).toBe(false);

    await holder.release();
    const contender = await contenderP;
    expect(contenderGranted).toBe(true);
    await contender.release();
  });
});
