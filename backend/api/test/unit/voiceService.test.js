/**
 * Unit tests for backend/api/src/services/voiceService.js
 *
 * Coverage:
 *   - getBookingContext: returns null when userId is falsy
 *   - getBookingContext: returns null when order query errors
 *   - getBookingContext: returns order when bookingId is a UUID matching customer_id
 *   - getBookingContext: returns order when bookingId is a display ID matching driver_id
 *   - trimCache: purges expired entries on every call
 *   - trimCache: evicts oldest entries when cache exceeds MAX_CACHE_SIZE
 *   - cacheAudio: stores audio in cache and triggers trimCache
 *   - processVoiceQuery: returns mock response when API keys are missing
 *   - processVoiceQuery: uses mock booking data to build response text
 *   - processVoiceQuery: returns mock when only OPENAI_API_KEY is set
 *   - processVoiceQuery: returns mock when only ELEVENLABS_API_KEY is set
 *
 * Run with:  npm run test:unit -- test/unit/voiceService.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('axios');

const mockSupabaseFrom = vi.hoisted(() => vi.fn());

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: mockSupabaseFrom,
  },
}));

// Mock crypto
vi.mock('crypto', () => ({
  default: {
    randomInt: vi.fn(() => 0),
    randomUUID: vi.fn(() => 'test-uuid-1234'),
    randomBytes: vi.fn(() => ({ toString: () => 'test-hex' })),
  },
}));

import {
  processVoiceQuery,
  __testing,
  audioCache,
} from '../../src/services/voiceService.js';

const { getBookingContext, trimCache, cacheAudio, MAX_CACHE_SIZE, CACHE_TTL_MS } = __testing;

describe('voiceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioCache.clear();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
  });

  describe('getBookingContext', () => {
    it('returns null when userId is falsy', async () => {
      const result = await getBookingContext('booking-1', null);
      expect(result).toBeNull();
    });

    it('returns null when userId is empty string', async () => {
      const result = await getBookingContext('booking-1', '');
      expect(result).toBeNull();
    });

    it('returns order when bookingId is a UUID matching customer_id', async () => {
      const mockOrder = { id: 'uuid-123', status: 'in_transit' };
      const eqFn = vi.fn(() => ({
        or: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: mockOrder, error: null })),
        })),
      }));
      const selectFn = vi.fn(() => ({
        eq: eqFn,
      }));
      mockSupabaseFrom.mockReturnValue({ select: selectFn });

      const result = await getBookingContext(
        '550e8400-e29b-41d4-a716-446655440000',
        'user-123'
      );

      expect(result).toEqual(mockOrder);
    });

    it('returns order when bookingId is a display ID matching driver_id', async () => {
      const mockOrder = { id: 'order-1', order_display_id: 'DISP-001', status: 'picked_up' };
      const eqFn = vi.fn(() => ({
        or: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: mockOrder, error: null })),
        })),
      }));
      const selectFn = vi.fn(() => ({
        eq: eqFn,
      }));
      mockSupabaseFrom.mockReturnValue({ select: selectFn });

      const result = await getBookingContext('DISP-001', 'driver-456');

      expect(result).toEqual(mockOrder);
    });

    it('returns null when order query returns an error', async () => {
      const eqFn = vi.fn(() => ({
        or: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: { message: 'Table not found' } })),
        })),
      }));
      const selectFn = vi.fn(() => ({
        eq: eqFn,
      }));
      mockSupabaseFrom.mockReturnValue({ select: selectFn });

      const result = await getBookingContext('ORDER-001', 'user-789');

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Orders table check failed in voiceService:',
        'Table not found'
      );
    });

    it('returns null when order query throws', async () => {
      const eqFn = vi.fn(() => {
        throw new Error('Network timeout');
      });
      const selectFn = vi.fn(() => ({
        eq: eqFn,
      }));
      mockSupabaseFrom.mockReturnValue({ select: selectFn });

      const result = await getBookingContext('ORDER-001', 'user-789');

      expect(result).toBeNull();
    });
  });

  describe('trimCache', () => {
    it('purges expired entries', () => {
      const now = Date.now();
      audioCache.set('key-old', { buffer: Buffer.from('a'), userId: 'u1', timestamp: now - CACHE_TTL_MS - 1000 });
      audioCache.set('key-recent', { buffer: Buffer.from('b'), userId: 'u2', timestamp: now });

      trimCache();

      expect(audioCache.has('key-old')).toBe(false);
      expect(audioCache.has('key-recent')).toBe(true);
    });

    it('evicts oldest entries when cache exceeds MAX_CACHE_SIZE', () => {
      const now = Date.now();
      // Fill cache to MAX_CACHE_SIZE + 5 entries
      for (let i = 0; i < MAX_CACHE_SIZE + 5; i++) {
        audioCache.set(`key-${i}`, { buffer: Buffer.from(`data-${i}`), userId: 'u1', timestamp: now + i });
      }

      trimCache();

      expect(audioCache.size).toBeLessThanOrEqual(MAX_CACHE_SIZE);
    });

    it('does not evict when cache size is within limit', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        audioCache.set(`key-${i}`, { buffer: Buffer.from(`data-${i}`), userId: 'u1', timestamp: now + i });
      }

      trimCache();

      expect(audioCache.size).toBe(5);
    });
  });

  describe('cacheAudio', () => {
    it('stores audio in cache', () => {
      const buffer = Buffer.from('test-audio-data');
      cacheAudio('audio-id-1', buffer, 'user-abc');

      expect(audioCache.has('audio-id-1')).toBe(true);
      expect(audioCache.get('audio-id-1').buffer).toBe(buffer);
      expect(audioCache.get('audio-id-1').userId).toBe('user-abc');
    });

    it('triggers trimCache when cache exceeds limits', () => {
      const now = Date.now();
      // Pre-fill cache to MAX_CACHE_SIZE - 1 entries
      for (let i = 0; i < MAX_CACHE_SIZE - 1; i++) {
        audioCache.set(`existing-${i}`, { buffer: Buffer.from(`d${i}`), userId: 'u1', timestamp: now + i });
      }

      cacheAudio('new-audio', Buffer.from('new-data'), 'user-new');

      // New audio should be in cache
      expect(audioCache.has('new-audio')).toBe(true);
    });
  });

  describe('processVoiceQuery', () => {
    it('returns mock response when API keys are missing', async () => {
      const result = await processVoiceQuery('user-1', 'booking-1', Buffer.from('audio'), 'audio.wav');

      expect(result.transcript).toBeTruthy();
      expect(result.response_text).toBeTruthy();
      expect(result.audio_url).toMatch(/^\/api\/voice\/audio\//);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Missing OpenAI or ElevenLabs API keys')
      );
    });

    it('uses mock booking data to build response text', async () => {
      const mockOrder = { status: 'in_transit', eta: '3 hours' };
      const eqFn = vi.fn(() => ({
        or: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: mockOrder, error: null })),
        })),
      }));
      const selectFn = vi.fn(() => ({
        eq: eqFn,
      }));
      mockSupabaseFrom.mockReturnValue({ select: selectFn });

      const result = await processVoiceQuery('user-1', 'booking-1', Buffer.from('audio'), 'audio.wav');

      expect(result.transcript).toBeTruthy();
      expect(result.response_text).toContain('in transit');
    });

    it('returns mock when only OPENAI_API_KEY is set', async () => {
      process.env.ELEVENLABS_API_KEY = 'test-key';

      const result = await processVoiceQuery('user-1', 'booking-1', Buffer.from('audio'), 'audio.wav');

      expect(result.audio_url).toMatch(/^\/api\/voice\/audio\//);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Missing OpenAI or ElevenLabs API keys')
      );
    });

    it('returns mock when only ELEVENLABS_API_KEY is set', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const result = await processVoiceQuery('user-1', 'booking-1', Buffer.from('audio'), 'audio.wav');

      expect(result.audio_url).toMatch(/^\/api\/voice\/audio\//);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Missing OpenAI or ElevenLabs API keys')
      );
    });

    it('returns mock when neither key is present regardless of order data', async () => {
      mockSupabaseFrom.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ or: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })) })) });

      const result = await processVoiceQuery('user-1', 'booking-1', Buffer.from('audio'), 'audio.wav');

      // Should still return a valid mock response even with no booking data
      expect(result.transcript).toBeTruthy();
      expect(result.response_text).toBeTruthy();
      expect(result.audio_url).toMatch(/^\/api\/voice\/audio\//);
    });
  });
});
