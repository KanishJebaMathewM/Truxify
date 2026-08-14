import { describe, it, expect, beforeEach } from 'vitest';
import { __testing } from '../../../src/services/voiceService.js';

const { trimCache, audioCache, MAX_CACHE_SIZE, CACHE_TTL_MS } = __testing;

describe('trimCache', () => {
  beforeEach(() => {
    audioCache.clear();
  });

  it('evicts expired entries', () => {
    const now = Date.now();
    audioCache.set('key1', { buffer: Buffer.from('a'), userId: 'u1', timestamp: now - CACHE_TTL_MS - 1 });
    audioCache.set('key2', { buffer: Buffer.from('b'), userId: 'u2', timestamp: now });
    trimCache();
    expect(audioCache.has('key1')).toBe(false);
    expect(audioCache.has('key2')).toBe(true);
  });

  it('evicts oldest entries when capacity exceeded after expiry purge', () => {
    const now = Date.now();
    for (let i = 0; i < MAX_CACHE_SIZE + 20; i++) {
      audioCache.set(`key${i}`, { buffer: Buffer.from(`d${i}`), userId: `u${i}`, timestamp: now - i });
    }
    trimCache();
    expect(audioCache.size).toBeLessThanOrEqual(MAX_CACHE_SIZE);
  });

  it('does nothing on empty cache', () => {
    trimCache();
    expect(audioCache.size).toBe(0);
  });

  it('evicts only expired entries when cache is below capacity', () => {
    const now = Date.now();
    audioCache.set('old', { buffer: Buffer.from('a'), userId: 'u1', timestamp: now - CACHE_TTL_MS - 1 });
    audioCache.set('recent', { buffer: Buffer.from('b'), userId: 'u2', timestamp: now });
    trimCache();
    expect(audioCache.size).toBe(1);
    expect(audioCache.has('recent')).toBe(true);
  });

  it('deletes expired entries before checking capacity', () => {
    const now = Date.now();
    // Fill with expired entries
    for (let i = 0; i < MAX_CACHE_SIZE + 10; i++) {
      audioCache.set(`expired${i}`, { buffer: Buffer.from('a'), userId: 'u1', timestamp: now - CACHE_TTL_MS - 1 });
    }
    // Add some recent entries
    for (let i = 0; i < 5; i++) {
      audioCache.set(`recent${i}`, { buffer: Buffer.from('b'), userId: 'u2', timestamp: now });
    }
    trimCache();
    // All expired should be gone, recent should remain
    expect(audioCache.size).toBe(5);
  });
});
