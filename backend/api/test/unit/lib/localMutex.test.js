import { describe, it, expect } from 'vitest';
import {
  acquireLocalMutex,
  __localMutexKeyCount,
  DEFAULT_LOCAL_LEASE_MS,
} from '../../../src/lib/localMutex.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('localMutex (lease-based in-process fallback lock)', () => {
  it('grants the lock immediately when it is free', async () => {
    const lease = await acquireLocalMutex('free', 1000);
    expect(lease.isHeld()).toBe(true);
    expect(lease.release()).toBe(true);
    expect(lease.isHeld()).toBe(false);
  });

  it('grants waiters strictly in FIFO order and never concurrently', async () => {
    const order = [];
    let inside = 0;
    let maxInside = 0;

    const worker = async (name) => {
      const lease = await acquireLocalMutex('fifo', 1000);
      inside++;
      maxInside = Math.max(maxInside, inside);
      order.push(name);
      await sleep(15);
      inside--;
      lease.release();
    };

    await Promise.all([worker('a'), worker('b'), worker('c'), worker('d')]);

    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(maxInside).toBe(1);
  });

  it('starts each lease when the lock is GRANTED, not when the caller queued', async () => {
    // Regression: the TTL timer used to be armed at enqueue time, so a waiter
    // queued behind a slow holder "expired" before it ever ran and released its
    // gate to the next waiter, letting several callers into the critical section.
    const first = await acquireLocalMutex('lease-at-grant', 1000);

    let secondGranted = false;
    let thirdGranted = false;
    const secondP = acquireLocalMutex('lease-at-grant', 120).then((l) => { secondGranted = true; return l; });
    const thirdP = acquireLocalMutex('lease-at-grant', 120).then((l) => { thirdGranted = true; return l; });

    await sleep(200); // longer than the second waiter's own 120ms TTL
    expect(secondGranted).toBe(false); // still queued behind `first`
    expect(thirdGranted).toBe(false);

    first.release();
    const second = await secondP;

    // Granted ~200ms after it queued: with the bug its 120ms lease would
    // already be spent and the third waiter would be let in immediately.
    await sleep(40);
    expect(second.isHeld()).toBe(true);
    expect(thirdGranted).toBe(false);

    second.release();
    const third = await thirdP;
    expect(thirdGranted).toBe(true);
    third.release();
  });

  it('auto-releases an expired lease and hands the lock to the next waiter', async () => {
    const stuck = await acquireLocalMutex('expiry', 40); // holder never releases
    const startedAt = Date.now();
    const next = await acquireLocalMutex('expiry', 1000);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30);
    expect(stuck.isHeld()).toBe(false);
    expect(next.isHeld()).toBe(true);
    next.release();
  });

  it('fences stale handles: releasing an expired lease never frees the new owner', async () => {
    const stale = await acquireLocalMutex('fence', 30);
    const owner = await acquireLocalMutex('fence', 1000); // granted once `stale` expires

    let waiterGranted = false;
    const waiterP = acquireLocalMutex('fence', 1000).then((l) => { waiterGranted = true; return l; });

    expect(stale.release()).toBe(false); // late release from the expired holder
    await sleep(20);

    expect(owner.isHeld()).toBe(true); // new owner untouched
    expect(waiterGranted).toBe(false); // waiter NOT let in on top of the owner

    owner.release();
    (await waiterP).release();
  });

  it('release() is idempotent', async () => {
    const lease = await acquireLocalMutex('idempotent', 1000);
    expect(lease.release()).toBe(true);
    expect(lease.release()).toBe(false);
  });

  it('does not leak per-key state once everything is released', async () => {
    const before = __localMutexKeyCount();
    const a = await acquireLocalMutex('cleanup', 1000);
    const bP = acquireLocalMutex('cleanup', 1000);
    a.release();
    (await bP).release();
    expect(__localMutexKeyCount()).toBe(before);
  });

  it('keeps independent keys independent', async () => {
    const a = await acquireLocalMutex('key-a', 1000);
    const b = await acquireLocalMutex('key-b', 1000); // must not wait for key-a
    expect(a.isHeld()).toBe(true);
    expect(b.isHeld()).toBe(true);
    a.release();
    b.release();
  });

  it('extend() pushes the expiry out and fails once the lease is gone', async () => {
    const lease = await acquireLocalMutex('extend', 60);
    for (let i = 0; i < 5; i++) {
      await sleep(30);
      expect(lease.extend(60)).toBe(true); // total 150ms > the original 60ms TTL
    }
    expect(lease.isHeld()).toBe(true);

    await sleep(100); // stop extending -> lease lapses
    expect(lease.isHeld()).toBe(false);
    expect(lease.extend(60)).toBe(false);
  });

  it('falls back to a sane default lease for a missing / invalid TTL', async () => {
    expect(DEFAULT_LOCAL_LEASE_MS).toBeGreaterThan(1000);
    for (const bad of [undefined, NaN, 0, -5]) {
      const lease = await acquireLocalMutex(`bad-ttl-${String(bad)}`, bad);
      await sleep(20);
      expect(lease.isHeld()).toBe(true); // an invalid TTL must not expire instantly
      lease.release();
    }
  });
});
