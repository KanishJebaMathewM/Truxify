/**
 * @fileoverview Unit tests for EscrowLockManager
 * Tests atomic locking, state machine enforcement, and idempotency guarantees.
 * Resolves Issue #11224.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    EscrowLockManager,
    ESCROW_STATE_TRANSITIONS,
    ESCROW_TERMINAL_STATES,
    DEFAULT_LOCK_TTL_SECONDS
} from '../../../src/lib/escrow/escrowLockManager.js';

// Mock Redis with comprehensive command support
class MockRedis {
    constructor() {
        this.store = new Map();
        this.status = 'ready';
        this.ttls = new Map();
    }

    async set(key, value, ...args) {
        // Handle NX and EX flags
        const nxIndex = args.indexOf('NX');
        const exIndex = args.indexOf('EX');

        if (nxIndex !== -1 && this.store.has(key)) {
            return null; // NX fails if key exists
        }

        this.store.set(key, value);

        if (exIndex !== -1 && args[exIndex + 1]) {
            this.ttls.set(key, Date.now() + args[exIndex + 1] * 1000);
        }

        return 'OK';
    }

    async get(key) {
        return this.store.get(key) || null;
    }

    async del(...keys) {
        let count = 0;
        for (const key of keys) {
            if (this.store.delete(key)) count++;
        }
        return count;
    }

    async expire(key, seconds) {
        if (!this.store.has(key)) return 0;
        this.ttls.set(key, Date.now() + seconds * 1000);
        return 1;
    }

    async eval(script, numKeys, ...args) {
        // Simplified Lua script execution for compare-and-delete
        const key = args[0];
        const token = args[1];

        if (this.store.get(key) === token) {
            this.store.delete(key);
            return 1;
        }
        return 0;
    }

    pipeline() {
        const commands = [];
        const self = this;

        const pipelineObj = {
            get: (key) => { commands.push({ cmd: 'get', args: [key] }); return pipelineObj; },
            set: (key, value) => { commands.push({ cmd: 'set', args: [key, value] }); return pipelineObj; },
            setnx: (key, value) => { commands.push({ cmd: 'setnx', args: [key, value] }); return pipelineObj; },
            expire: (key, seconds) => { commands.push({ cmd: 'expire', args: [key, seconds] }); return pipelineObj; },
            exec: async () => {
                const results = [];
                for (const { cmd, args } of commands) {
                    if (cmd === 'get') {
                        results.push([null, self.store.get(args[0]) || null]);
                    } else if (cmd === 'set') {
                        self.store.set(args[0], args[1]);
                        results.push([null, 'OK']);
                    } else if (cmd === 'setnx') {
                        if (!self.store.has(args[0])) {
                            self.store.set(args[0], args[1]);
                            results.push([null, 1]);
                        } else {
                            results.push([null, 0]);
                        }
                    } else if (cmd === 'expire') {
                        if (self.store.has(args[0])) {
                            self.ttls.set(args[0], Date.now() + args[1] * 1000);
                            results.push([null, 1]);
                        } else {
                            results.push([null, 0]);
                        }
                    }
                }
                return results;
            }
        };

        return pipelineObj;
    }
}

describe('EscrowLockManager (#11224)', () => {
    let manager;
    let redis;
    const ORDER_ID = 'order-test-123';

    beforeEach(() => {
        redis = new MockRedis();
        manager = new EscrowLockManager(redis);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Lock Acquisition', () => {
        it('should acquire lock successfully when not held', async () => {
            const result = await manager.acquireLock(ORDER_ID);

            expect(result.acquired).toBe(true);
            expect(result.token).toBeDefined();
            expect(typeof result.token).toBe('string');
            expect(result.token.length).toBe(32); // 16 bytes hex
        });

        it('should reject second acquisition attempt (mutex property)', async () => {
            const result1 = await manager.acquireLock(ORDER_ID);
            expect(result1.acquired).toBe(true);

            const manager2 = new EscrowLockManager(redis);
            const result2 = await manager2.acquireLock(ORDER_ID);

            expect(result2.acquired).toBe(false);
            expect(result2.token).toBeNull();
        });

        it('should return currentState and version on acquisition', async () => {
            // Set up initial state
            await redis.set(`escrow_state:${ORDER_ID}`, 'pending');
            await redis.set(`escrow_version:${ORDER_ID}`, '5');

            const result = await manager.acquireLock(ORDER_ID);

            expect(result.currentState).toBe('pending');
            expect(result.version).toBe(5);
        });

        it('should respect expectedState option', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'funding');

            // Should succeed with matching expectation
            const success = await manager.acquireLock(ORDER_ID, { expectedState: 'funding' });
            expect(success.acquired).toBe(true);
            await manager.releaseLock(ORDER_ID, success.token);

            // Should fail with mismatched expectation
            const failure = await manager.acquireLock(ORDER_ID, { expectedState: 'pending' });
            expect(failure.acquired).toBe(false);
            expect(failure.error).toBe('STATE_MISMATCH');
        });

        it('should release lock automatically on expectedState mismatch', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'funding');

            const result = await manager.acquireLock(ORDER_ID, { expectedState: 'pending' });
            expect(result.acquired).toBe(false);

            // Lock should be released so another caller can acquire
            const result2 = await manager.acquireLock(ORDER_ID);
            expect(result2.acquired).toBe(true);
        });
    });

    describe('State Machine Validation', () => {
        it('should validate allowed transitions correctly', () => {
            expect(manager.isValidTransition('pending', 'funding')).toBe(true);
            expect(manager.isValidTransition('pending', 'cancelled')).toBe(true);
            expect(manager.isValidTransition('pending', 'funded')).toBe(false);
            expect(manager.isValidTransition('funding', 'confirming')).toBe(true);
            expect(manager.isValidTransition('confirming', 'funded')).toBe(true);
            expect(manager.isValidTransition('funded', 'released')).toBe(true);
        });

        it('should reject invalid transitions on lock acquisition', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'pending');

            // Attempt invalid transition from pending -> funded (skipping funding/confirming)
            const result = await manager.acquireLock(ORDER_ID, {
                targetState: 'funded'
            });

            expect(result.acquired).toBe(false);
            expect(result.error).toBe('INVALID_STATE_TRANSITION');
        });

        it('should allow valid transitions via transitionState', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'pending');
            await redis.set(`escrow_version:${ORDER_ID}`, '0');

            const lock = await manager.acquireLock(ORDER_ID);
            expect(lock.acquired).toBe(true);

            const result = await manager.transitionState(ORDER_ID, lock.token, 'funding', 0);

            expect(result.success).toBe(true);
            expect(result.newVersion).toBe(1);

            const state = await redis.get(`escrow_state:${ORDER_ID}`);
            expect(state).toBe('funding');
        });

        it('should reject invalid transitions in transitionState', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'pending');
            await redis.set(`escrow_version:${ORDER_ID}`, '0');

            const lock = await manager.acquireLock(ORDER_ID);
            const result = await manager.transitionState(ORDER_ID, lock.token, 'released', 0);

            expect(result.success).toBe(false);
            expect(result.error).toBe('INVALID_TRANSITION');
        });

        it('should identify terminal states correctly', () => {
            expect(ESCROW_TERMINAL_STATES).toContain('released');
            expect(ESCROW_TERMINAL_STATES).toContain('refunded');
            expect(ESCROW_TERMINAL_STATES).toContain('cancelled');
            expect(ESCROW_TERMINAL_STATES).not.toContain('funding');
        });

        it('should allow all valid state transitions defined in ESCROW_STATE_TRANSITIONS', () => {
            // Verify the state machine is well-formed
            for (const [state, allowedNext] of Object.entries(ESCROW_STATE_TRANSITIONS)) {
                expect(Array.isArray(allowedNext)).toBe(true);
                for (const next of allowedNext) {
                    expect(ESCROW_STATE_TRANSITIONS).toHaveProperty(next);
                }
            }
        });
    });

    describe('Lock Release with Token Verification', () => {
        it('should release lock only with correct token', async () => {
            const lock = await manager.acquireLock(ORDER_ID);
            expect(lock.acquired).toBe(true);

            const released = await manager.releaseLock(ORDER_ID, lock.token);
            expect(released).toBe(true);

            // Lock should now be available
            const lock2 = await manager.acquireLock(ORDER_ID);
            expect(lock2.acquired).toBe(true);
        });

        it('should reject release with wrong token', async () => {
            const lock = await manager.acquireLock(ORDER_ID);

            const released = await manager.releaseLock(ORDER_ID, 'wrong-token');
            expect(released).toBe(false);

            // Original lock should still be held
            const lock2 = await manager.acquireLock(ORDER_ID);
            expect(lock2.acquired).toBe(false);
        });

        it('should handle release of already-released lock gracefully', async () => {
            const lock = await manager.acquireLock(ORDER_ID);

            await manager.releaseLock(ORDER_ID, lock.token);
            const secondRelease = await manager.releaseLock(ORDER_ID, lock.token);

            expect(secondRelease).toBe(false);
        });

        it('should handle release with null token', async () => {
            const released = await manager.releaseLock(ORDER_ID, null);
            expect(released).toBe(false);
        });
    });

    describe('Lock Extension', () => {
        it('should extend lock TTL when owned', async () => {
            const lock = await manager.acquireLock(ORDER_ID);
            const extended = await manager.extendLock(ORDER_ID, lock.token);

            expect(extended).toBe(true);
        });

        it('should reject extension by non-owner', async () => {
            const lock = await manager.acquireLock(ORDER_ID);
            const extended = await manager.extendLock(ORDER_ID, 'wrong-token');

            expect(extended).toBe(false);
        });

        it('should enforce maximum extensions limit', async () => {
            const lock = await manager.acquireLock(ORDER_ID);

            // Extend max times
            for (let i = 0; i < 3; i++) {
                const result = await manager.extendLock(ORDER_ID, lock.token);
                expect(result).toBe(true);
            }

            // Next extension should fail
            const final = await manager.extendLock(ORDER_ID, lock.token);
            expect(final).toBe(false);
        });
    });

    describe('withLock High-Level API', () => {
        it('should execute function with lock context', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'pending');
            await redis.set(`escrow_version:${ORDER_ID}`, '0');

            const result = await manager.withLock(ORDER_ID, async (ctx) => {
                expect(ctx.token).toBeDefined();
                expect(ctx.currentState).toBe('pending');
                expect(ctx.version).toBe(0);
                expect(typeof ctx.transition).toBe('function');
                expect(typeof ctx.extend).toBe('function');

                return 'success';
            });

            expect(result).toBe('success');
        });

        it('should release lock even if function throws', async () => {
            await expect(manager.withLock(ORDER_ID, async () => {
                throw new Error('Business logic failure');
            })).rejects.toThrow('Business logic failure');

            // Lock should be released despite error
            const newLock = await manager.acquireLock(ORDER_ID);
            expect(newLock.acquired).toBe(true);
        });

        it('should provide working transition helper', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'funding');
            await redis.set(`escrow_version:${ORDER_ID}`, '2');

            await manager.withLock(ORDER_ID, async (ctx) => {
                const result = await ctx.transition('confirming');
                expect(result.success).toBe(true);
                expect(ctx.currentState).toBe('confirming');
                expect(ctx.version).toBe(3);
            });

            const finalState = await redis.get(`escrow_state:${ORDER_ID}`);
            expect(finalState).toBe('confirming');
        });

        it('should throw with LOCK_UNAVAILABLE error when lock cannot be acquired', async () => {
            // Acquire lock with one manager
            const lock = await manager.acquireLock(ORDER_ID);

            // Try withLock from another manager - should fail
            const manager2 = new EscrowLockManager(redis);
            await expect(manager2.withLock(ORDER_ID, async () => { }))
                .rejects.toThrow(/Failed to acquire escrow lock/);

            await manager.releaseLock(ORDER_ID, lock.token);
        });
    });

    describe('Redis Failure Handling', () => {
        it('should fail gracefully when Redis is disconnected', async () => {
            redis.status = 'disconnected';

            const result = await manager.acquireLock(ORDER_ID);
            expect(result.acquired).toBe(false);
        });

        it('should handle null redis client', async () => {
            const managerNoRedis = new EscrowLockManager(null);

            const result = await managerNoRedis.acquireLock(ORDER_ID);
            expect(result.acquired).toBe(false);
        });
    });

    describe('Cleanup and State Management', () => {
        it('should set initial state with setnx semantics', async () => {
            await manager.setInitialState(ORDER_ID, 'pending');

            const state = await redis.get(`escrow_state:${ORDER_ID}`);
            expect(state).toBe('pending');

            // Second call should not overwrite
            await manager.setInitialState(ORDER_ID, 'funding');
            const state2 = await redis.get(`escrow_state:${ORDER_ID}`);
            expect(state2).toBe('pending');
        });

        it('should clean up all keys for an order', async () => {
            await redis.set(`escrow_lock:${ORDER_ID}`, 'token');
            await redis.set(`escrow_state:${ORDER_ID}`, 'funded');
            await redis.set(`escrow_version:${ORDER_ID}`, '5');

            await manager.cleanupOrder(ORDER_ID);

            expect(await redis.get(`escrow_lock:${ORDER_ID}`)).toBeNull();
            expect(await redis.get(`escrow_state:${ORDER_ID}`)).toBeNull();
            expect(await redis.get(`escrow_version:${ORDER_ID}`)).toBeNull();
        });

        it('should query state without acquiring lock', async () => {
            await redis.set(`escrow_state:${ORDER_ID}`, 'confirming');
            await redis.set(`escrow_version:${ORDER_ID}`, '7');

            const result = await manager.getEscrowState(ORDER_ID);

            expect(result.state).toBe('confirming');
            expect(result.version).toBe(7);
        });
    });
});
