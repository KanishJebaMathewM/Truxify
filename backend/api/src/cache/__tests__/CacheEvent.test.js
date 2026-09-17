import { describe, it, expect } from 'vitest';
import {
    CacheEventType,
    createCacheEvent,
    serializeCacheEvent,
    deserializeCacheEvent
} from '../CacheEvent.js';

describe('CacheEvent Module', () => {
    describe('createCacheEvent', () => {
        it('should create a valid INVALIDATE_KEY event', () => {
            const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
                namespace: 'user_profile',
                key: 'user:123',
            });

            expect(event.type).toBe(CacheEventType.INVALIDATE_KEY);
            expect(event.namespace).toBe('user_profile');
            expect(event.key).toBe('user:123');
            expect(event.id).toBeDefined();
            expect(event.timestamp).toBeDefined();
        });

        it('should throw TypeError for invalid event type', () => {
            expect(() => createCacheEvent('INVALID_TYPE', { namespace: 'test' })).toThrow(
                'Invalid cache event type "INVALID_TYPE".'
            );
        });

        it('should throw TypeError if namespace is missing', () => {
            expect(() => createCacheEvent(CacheEventType.REFRESH, {})).toThrow(
                'Option "namespace" is required and must be a non-empty string.'
            );
        });

        it('should throw TypeError if key is missing for INVALIDATE_KEY', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'test' })).toThrow(
                'Option "key" is required for event type "INVALIDATE_KEY".'
            );
        });

        it('should throw TypeError if pattern is missing for INVALIDATE_PATTERN', () => {
            expect(() => createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'test' })).toThrow(
                'Option "pattern" is required for event type "INVALIDATE_PATTERN".'
            );
        });
    });

    describe('serializeCacheEvent and deserializeCacheEvent', () => {
        it('should serialize and deserialize an event correctly', () => {
            const originalEvent = createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, {
                namespace: 'global_config',
            });

            const serialized = serializeCacheEvent(originalEvent);
            const deserialized = deserializeCacheEvent(serialized);

            expect(deserialized).toEqual(originalEvent);
        });

        it('should return null for invalid JSON', () => {
            const result = deserializeCacheEvent('{ invalid json }');
            expect(result).toBeNull();
        });

        it('should return null for missing namespace in deserialized object', () => {
            const invalidJson = JSON.stringify({ type: 'REFRESH' });
            const result = deserializeCacheEvent(invalidJson);
            expect(result).toBeNull();
        });
    });
});
