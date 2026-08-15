/**
 * Unit tests for backend/api/src/cache/CachePublisher.js
 *
 * Coverage:
 *   - constructor: accepts eventBus and publisher
 *   - constructor: works without eventBus
 *   - publish: sends cache event with correct type
 *   - publish: sends cache event with key
 *   - publish: uses eventBus when available
 *   - publish: does not throw when eventBus missing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));
vi.mock('../../src/cache/CacheEvent.js', () => ({
  CacheEvent: class MockCacheEvent {
    constructor(type, key, meta, ts) {
      this.type = type; this.key = key; this.metadata = meta || {}; this.timestamp = ts || Date.now();
    }
    static createInvalidate(key, meta) { return new MockCacheEvent('INVALIDATE', key, meta); }
    static createRefresh(key, meta) { return new MockCacheEvent('REFRESH', key, meta); }
    toJSON() { return { type: this.type, key: this.key, metadata: this.metadata, timestamp: this.timestamp }; }
  },
}));
vi.mock('../../src/core/events/EventBus.js', () => ({ EventBus: vi.fn() }));

const CachePublisher = (await import('../../src/cache/CachePublisher.js')).CachePublisher;

describe('CachePublisher', () => {
  let mockEventBus;
  let mockPublisher;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    mockPublisher = { publish: vi.fn().mockResolvedValue(undefined) };
  });

  describe('constructor', () => {
    it('accepts eventBus and publisher', () => {
      const pub = new CachePublisher({ eventBus: mockEventBus, publisher: mockPublisher });
      expect(pub.eventBus).toBe(mockEventBus);
      expect(pub.publisher).toBe(mockPublisher);
    });

    it('works without eventBus', () => {
      expect(() => new CachePublisher({ publisher: mockPublisher })).not.toThrow();
    });
  });

  describe('publish', () => {
    it('sends cache event with REFRESH type', async () => {
      const pub = new CachePublisher({ eventBus: mockEventBus });
      await pub.publish('REFRESH', 'user:123');
      expect(mockEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'REFRESH', key: 'user:123' }));
    });

    it('sends cache event with key', async () => {
      const pub = new CachePublisher({ eventBus: mockEventBus });
      await pub.publish('REFRESH', 'order:456', { reason: 'update' });
      expect(mockEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ key: 'order:456' }));
    });

    it('uses eventBus when available', async () => {
      const pub = new CachePublisher({ eventBus: mockEventBus });
      await pub.publish('INVALIDATE', 'session:abc');
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('does not throw when eventBus missing', async () => {
      const pub = new CachePublisher({});
      await expect(pub.publish('INVALIDATE', 'key:xyz')).resolves.not.toThrow();
    });
  });
});
