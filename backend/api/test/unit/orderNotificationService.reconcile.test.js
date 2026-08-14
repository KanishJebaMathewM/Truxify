/**
 * Unit tests for backend/api/src/services/order/orderNotificationService.js
 *
 * Regression test for issue #11211: the in-memory OTP lockout fallback (used
 * when Redis is unreachable) drifted from Redis state during a resync. Because
 * offline attempts were never folded back into Redis, an attacker who exhausted
 * the in-memory budget could start fresh against Redis once it recovered, and a
 * Redis-side lock could be shadowed by a stale in-memory record.
 *
 * These tests drive the module through a Redis outage -> recovery transition
 * and assert the in-memory attempts are merged into Redis so the lockout is
 * preserved.
 *
 * Run with:  npm test -- test/unit/orderNotificationService.reconcile.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = { counts: new Map(), locks: new Map() };
let redisMode = 'up';

const redisClient = {
  get: vi.fn((k) => (redisMode === 'down' ? Promise.reject(new Error('down')) : Promise.resolve(store.locks.get(k) ?? null))),
  set: vi.fn((k, v) => {
    if (redisMode === 'down') return Promise.reject(new Error('down'));
    store.locks.set(k, v);
    return Promise.resolve('OK');
  }),
  del: vi.fn((k) => {
    if (redisMode === 'down') return Promise.reject(new Error('down'));
    store.locks.delete(k);
    store.counts.delete(k);
    return Promise.resolve(1);
  }),
  incr: vi.fn((k) => {
    if (redisMode === 'down') return Promise.reject(new Error('down'));
    const n = (store.counts.get(k) || 0) + 1;
    store.counts.set(k, n);
    return Promise.resolve(n);
  }),
  incrby: vi.fn((k, by) => {
    if (redisMode === 'down') return Promise.reject(new Error('down'));
    const n = (store.counts.get(k) || 0) + by;
    store.counts.set(k, n);
    return Promise.resolve(n);
  }),
  expire: vi.fn(() => (redisMode === 'down' ? Promise.reject(new Error('down')) : Promise.resolve(1))),
};

vi.mock('../../src/config/db.js', () => ({ redisClient }));
vi.mock('../../src/services/notificationService.js', () => ({
  sendDeliveryOtpNotification: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  getActiveDeliveryOtp: vi.fn(),
}));

const { checkOtpLockout, recordOtpFailure, clearOtpState } = await import(
  '../../src/services/order/orderNotificationService.js'
);

describe('OTP lockout fallback reconciliation (issue #11211)', () => {
  beforeEach(() => {
    store.counts.clear();
    store.locks.clear();
    redisMode = 'up';
    vi.clearAllMocks();
  });

  it('accumulates attempts in memory and locks out while Redis is down', async () => {
    redisMode = 'down';
    for (let i = 0; i < 5; i += 1) await recordOtpFailure('order-down');
    expect(await checkOtpLockout('order-down')).toBe(true);
    // Nothing was persisted to Redis while it was down — the lock lives only
    // in the in-memory fallback.
    expect(store.counts.get('otp_failed_count:order-down')).toBeUndefined();
    expect(store.locks.get('otp_lockout:order-down')).toBeUndefined();
  });

  it('folds offline attempts into Redis on recovery so the lockout is preserved', async () => {
    redisMode = 'down';
    for (let i = 0; i < 5; i += 1) await recordOtpFailure('order-resync');
    expect(await checkOtpLockout('order-resync')).toBe(true);

    redisMode = 'up';
    // The next failure must reconcile the 5 offline attempts into Redis.
    await recordOtpFailure('order-resync');

    expect(redisClient.incrby).toHaveBeenCalledWith('otp_failed_count:order-resync', 5);
    expect(redisClient.set).toHaveBeenCalledWith(
      'otp_lockout:order-resync',
      '1',
      'EX',
      expect.any(Number),
    );
    // The merged lock is now the authoritative Redis state.
    expect(await checkOtpLockout('order-resync')).toBe(true);
  });

  it('does not let an attacker restart the budget after recovery', async () => {
    redisMode = 'down';
    for (let i = 0; i < 5; i += 1) await recordOtpFailure('order-budget');

    redisMode = 'up';
    // A correct-looking check right after recovery must still report locked,
    // because the offline attempts were merged into Redis first.
    expect(await checkOtpLockout('order-budget')).toBe(true);
    expect(redisClient.set).toHaveBeenCalledWith(
      'otp_lockout:order-budget',
      '1',
      'EX',
      expect.any(Number),
    );
  });

  it('drops the in-memory fallback after a successful Redis clear', async () => {
    redisMode = 'down';
    await recordOtpFailure('order-clear');
    redisMode = 'up';
    await clearOtpState('order-clear');
    expect(store.counts.get('otp_failed_count:order-clear')).toBeUndefined();
    expect(await checkOtpLockout('order-clear')).toBe(false);
  });
});
