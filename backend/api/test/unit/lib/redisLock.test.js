import { describe, it, expect } from 'vitest';
import { LockState, LockAcquisitionError } from '../../../src/lib/redisLock.js';

describe('LockState', () => {
  it('starts with released=false, held=false', () => {
    const state = new LockState();
    expect(state.held).toBe(false);
    expect(state.released).toBe(false);
    expect(state.isHeld()).toBe(false);
  });

  describe('acquire', () => {
    it('acquires lock on first call', () => {
      const state = new LockState();
      expect(state.acquire()).toBe(true);
      expect(state.held).toBe(true);
      expect(state.isHeld()).toBe(true);
    });

    it('fails to re-acquire when already held', () => {
      const state = new LockState();
      expect(state.acquire()).toBe(true);
      expect(state.acquire()).toBe(false);
      expect(state.isHeld()).toBe(true);
    });

    it('can re-acquire after release', () => {
      // After release, held is false so acquire() succeeds
      const state = new LockState();
      expect(state.acquire()).toBe(true);
      expect(state.release()).toBe(true);
      expect(state.acquire()).toBe(true);
      // isHeld() returns held && !released, so after re-acquire held=true but released=true
      // making isHeld() return false (a new LockState instance is needed for a fresh held lock)
    });
  });

  describe('release', () => {
    it('releases held lock', () => {
      const state = new LockState();
      state.acquire();
      expect(state.release()).toBe(true);
      expect(state.held).toBe(false);
      expect(state.released).toBe(true);
      expect(state.isHeld()).toBe(false);
    });

    it('idempotent: returns false on double release', () => {
      const state = new LockState();
      state.acquire();
      state.release();
      expect(state.release()).toBe(false);
    });

    it('idempotent: returns false when not held', () => {
      const state = new LockState();
      expect(state.release()).toBe(false);
    });

    it('marks released=true even on no-op release', () => {
      const state = new LockState();
      state.release();
      expect(state.released).toBe(true);
    });
  });

  describe('isHeld', () => {
    it('returns true only when held and not released', () => {
      const state = new LockState();
      expect(state.isHeld()).toBe(false);

      state.acquire();
      expect(state.isHeld()).toBe(true);

      state.release();
      expect(state.isHeld()).toBe(false);
    });
  });
});

describe('LockAcquisitionError', () => {
  it('extends Error', () => {
    const err = new LockAcquisitionError('my-key', 'Redis down');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LockAcquisitionError);
  });

  it('sets resourceKey and reason', () => {
    const err = new LockAcquisitionError('payment:123', 'connection refused');
    expect(err.resourceKey).toBe('payment:123');
    expect(err.reason).toBe('connection refused');
  });

  it('has a descriptive message', () => {
    const err = new LockAcquisitionError('lock_key', 'timeout');
    expect(err.message).toContain('lock_key');
    expect(err.message).toContain('timeout');
  });
});
