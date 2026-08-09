import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CacheEventType } from '../../src/cache/CacheEvent.js'

const mockPublisher = vi.hoisted(() => ({
  publishInvalidation: vi.fn(),
  subscribeToInvalidation: vi.fn(),
  setupMessageHandler: vi.fn(),
  getInstanceId: vi.fn(() => 'inst-1'),
}))

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

vi.mock('../../src/cache/CachePublisher.js', () => mockPublisher)
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }))

const invalidator = (await import('../../src/cache/CacheInvalidator.js')).default

function makeRedis() {
  return {
    del: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue('OK'),
    scan: vi.fn().mockResolvedValue(['0', []]),
    pipeline: vi.fn(() => {
      const p = { del: vi.fn().mockReturnValue(p), exec: vi.fn().mockResolvedValue([]) }
      return p
    }),
  }
}

describe('CacheInvalidator', () => {
  const redis = makeRedis()
  invalidator.initCacheInvalidator(redis)

  beforeEach(() => {
    vi.clearAllMocks()
    invalidator.resetStats()
    invalidator.initCacheInvalidator(redis)
  })

  it('invalidates a single key and publishes the event', async () => {
    await invalidator.invalidateKey('orders', 'orders:1')
    expect(redis.del).toHaveBeenCalledWith('orders:1')
    expect(mockPublisher.publishInvalidation).toHaveBeenCalled()
  })

  it('handles a remote INVALIDATE_KEY event locally', async () => {
    await invalidator.handleRemoteEvent({ type: CacheEventType.INVALIDATE_KEY, key: 'orders:2' })
    expect(redis.del).toHaveBeenCalledWith('orders:2')
  })

  it('bumps a version and publishes', async () => {
    await invalidator.bumpVersion('orders', 'entity-1')
    expect(redis.incr).toHaveBeenCalled()
    expect(mockPublisher.publishInvalidation).toHaveBeenCalled()
  })

  it('tracks and resets invalidation stats', async () => {
    await invalidator.invalidateKey('orders', 'k1')
    await invalidator.invalidateKey('orders', 'k2')
    expect(invalidator.getStats().invalidations).toBe(2)
    invalidator.resetStats()
    expect(invalidator.getStats().invalidations).toBe(0)
  })
})
