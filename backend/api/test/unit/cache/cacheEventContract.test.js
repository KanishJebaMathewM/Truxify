/**
 * @fileoverview Contract tests for CacheEvent module.
 * Verifies the STRICT validation contract enforced by createCacheEvent.
 * Resolves Issue #9898: Documents the new required-args API and validates it.
 * 
 * This test suite complements cacheEvent.test.js by focusing purely on the
 * validation contract - what arguments are required for each event type.
 */

import { describe, it, expect } from 'vitest';
import {
    createCacheEvent,
    CacheEventType
} from '../../../src/cache/CacheEvent.js';

describe('CacheEvent Validation Contract (#9898)', () => {
    describe('namespace is always required', () => {
        it('should throw TypeError when namespace is missing for INVALIDATE_KEY', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                key: 'user:123'
            })).toThrow('namespace');
        });

        it('should throw TypeError when namespace is missing for INVALIDATE_PATTERN', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
                pattern: 'user:*'
            })).toThrow('namespace');
        });

        it('should throw TypeError when namespace is missing for BUMP_VERSION', () => {
            expect(() => createCacheEvent(CacheEventType.BUMP_VERSION, {}))
                .toThrow('namespace');
        });

        it('should throw TypeError when namespace is empty string', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: '',
                key: 'user:123'
            })).toThrow('namespace');
        });

        it('should throw TypeError when namespace is whitespace only', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: '   ',
                key: 'user:123'
            })).toThrow('namespace');
        });

        it('should throw TypeError when namespace is not a string', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 123,
                key: 'user:123'
            })).toThrow('namespace');
        });

        it('should accept non-empty string namespace', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123'
            });
            expect(event.namespace).toBe('users');
        });
    });

    describe('INVALIDATE_KEY requires key', () => {
        it('should throw TypeError when key is missing', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users'
            })).toThrow('key');
        });

        it('should throw TypeError when key is empty string', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: ''
            })).toThrow('key');
        });

        it('should throw TypeError when key is whitespace only', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: '   '
            })).toThrow('key');
        });

        it('should throw TypeError when key is not a string', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 123
            })).toThrow('key');
        });

        it('should accept valid key string', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123'
            });
            expect(event.key).toBe('user:123');
            expect(event.type).toBe(CacheEventType.INVALIDATE_KEY);
        });

        it('should accept key with special characters', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123:profile:v2'
            });
            expect(event.key).toBe('user:123:profile:v2');
        });
    });

    describe('INVALIDATE_PATTERN requires pattern', () => {
        it('should throw TypeError when pattern is missing', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
                namespace: 'users'
            })).toThrow('pattern');
        });

        it('should throw TypeError when pattern is empty string', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
                namespace: 'users',
                pattern: ''
            })).toThrow('pattern');
        });

        it('should throw TypeError when pattern is whitespace only', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
                namespace: 'users',
                pattern: '   '
            })).toThrow('pattern');
        });

        it('should throw TypeError when pattern is not a string', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
                namespace: 'users',
                pattern: /regex/
            })).toThrow('pattern');
        });

        it('should accept valid pattern string', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
                namespace: 'users',
                pattern: 'user:*'
            });
            expect(event.pattern).toBe('user:*');
            expect(event.type).toBe(CacheEventType.INVALIDATE_PATTERN);
        });

        it('should accept pattern with wildcards', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
                namespace: 'cache',
                pattern: 'order:*:status'
            });
            expect(event.pattern).toBe('order:*:status');
        });
    });

    describe('BUMP_VERSION requires only namespace', () => {
        it('should succeed with only namespace', () => {
            const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
                namespace: 'users'
            });
            expect(event.type).toBe(CacheEventType.BUMP_VERSION);
            expect(event.namespace).toBe('users');
        });

        it('should accept optional timestamp override', () => {
            const customTimestamp = Date.now() - 1000;
            const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
                namespace: 'users',
                timestamp: customTimestamp
            });
            expect(event.timestamp).toBe(customTimestamp);
        });

        it('should auto-generate timestamp when not provided', () => {
            const before = Date.now();
            const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
                namespace: 'users'
            });
            const after = Date.now();

            expect(event.timestamp).toBeGreaterThanOrEqual(before);
            expect(event.timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe('Event object structure', () => {
        it('should include type field', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123'
            });
            expect(event.type).toBe(CacheEventType.INVALIDATE_KEY);
        });

        it('should include namespace field', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123'
            });
            expect(event.namespace).toBe('users');
        });

        it('should include timestamp field', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123'
            });
            expect(typeof event.timestamp).toBe('number');
        });

        it('should include id field (unique identifier)', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123'
            });
            expect(event.id).toBeDefined();
            expect(typeof event.id).toBe('string');
        });

        it('should generate unique IDs for each event', () => {
            const event1 = createCacheEvent(CacheEventType.BUMP_VERSION, {
                namespace: 'users'
            });
            const event2 = createCacheEvent(CacheEventType.BUMP_VERSION, {
                namespace: 'users'
            });
            expect(event1.id).not.toBe(event2.id);
        });

        it('should preserve optional metadata', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:123',
                metadata: { source: 'test', version: 1 }
            });
            expect(event.metadata).toEqual({ source: 'test', version: 1 });
        });
    });

    describe('All CacheEventType values are handled', () => {
        it('should handle every enum value', () => {
            const typeHandlers = {
                [CacheEventType.INVALIDATE_KEY]: { namespace: 'ns', key: 'k' },
                [CacheEventType.INVALIDATE_PATTERN]: { namespace: 'ns', pattern: 'p*' },
                [CacheEventType.BUMP_VERSION]: { namespace: 'ns' }
            };

            for (const [type, opts] of Object.entries(typeHandlers)) {
                expect(() => createCacheEvent(type, opts)).not.toThrow();
            }
        });

        it('should have all expected enum values', () => {
            expect(CacheEventType.INVALIDATE_KEY).toBeDefined();
            expect(CacheEventType.INVALIDATE_PATTERN).toBeDefined();
            expect(CacheEventType.BUMP_VERSION).toBeDefined();
        });
    });

    describe('Edge cases', () => {
        it('should throw for unknown event type', () => {
            expect(() => createCacheEvent('UNKNOWN_TYPE', { namespace: 'ns' }))
                .toThrow();
        });

        it('should throw when opts is null', () => {
            expect(() => createCacheEvent(CacheEventType.BUMP_VERSION, null))
                .toThrow();
        });

        it('should throw when opts is undefined', () => {
            expect(() => createCacheEvent(CacheEventType.BUMP_VERSION, undefined))
                .toThrow();
        });

        it('should throw when opts is not an object', () => {
            expect(() => createCacheEvent(CacheEventType.BUMP_VERSION, 'string'))
                .toThrow();
        });

        it('should handle very long keys', () => {
            const longKey = 'a'.repeat(1000);
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'ns',
                key: longKey
            });
            expect(event.key).toBe(longKey);
        });

        it('should handle unicode in namespace', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: '用户',
                key: 'user:123'
            });
            expect(event.namespace).toBe('用户');
        });

        it('should handle unicode in key', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'users',
                key: 'user:用户名'
            });
            expect(event.key).toBe('user:用户名');
        });
    });
});
