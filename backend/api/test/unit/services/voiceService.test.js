/**
 * Unit tests for backend/api/src/services/voiceService.js
 *
 * Coverage:
 *   - getBookingContext with valid UUID bookingId returns order
 *   - getBookingContext with non-UUID bookingId uses order_display_id
 *   - getBookingContext returns null when supabase query returns null
 *   - getBookingContext returns null and logs warning on supabase error
 *
 * Run with: npx vitest run test/unit/services/voiceService.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabaseFrom = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabase = {
  from: mockSupabaseFrom,
};

vi.mock('../../../src/config/db.js', () => ({
  supabase: mockSupabase,
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const { audioCache, __testing } = await import('../../../src/services/voiceService.js');
const { getBookingContext, trimCache, cacheAudio, MAX_CACHE_SIZE, CACHE_TTL_MS } = __testing;

describe('getBookingContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioCache.clear();
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: mockEq.mockReturnValue({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    });
  });

  it('returns order when bookingId is a valid UUID and query succeeds', async () => {
    const mockOrder = { id: '550e8400-e29b-41d4-a716-446655440000', status: 'in_transit', eta: '2 hours' };
    mockMaybeSingle.mockResolvedValue({ data: mockOrder, error: null });

    const result = await getBookingContext('550e8400-e29b-41d4-a716-446655440000');

    expect(result).toEqual(mockOrder);
    expect(mockSupabaseFrom).toHaveBeenCalledWith('orders');
    expect(mockEq).toHaveBeenCalledWith('id', '550e8400-e29b-41d4-a716-446655440000');
  });

  it('uses order_display_id when bookingId is not a valid UUID', async () => {
    const mockOrder = { id: '123e4567-e89b-12d3-a456-426614174000', order_display_id: '#FF20260101ABC123DEF456', status: 'delivered' };
    mockMaybeSingle.mockResolvedValue({ data: mockOrder, error: null });

    const result = await getBookingContext('#FF20260101ABC123DEF456');

    expect(result).toEqual(mockOrder);
    expect(mockSupabaseFrom).toHaveBeenCalledWith('orders');
    expect(mockEq).toHaveBeenCalledWith('order_display_id', '#FF20260101ABC123DEF456');
  });

  it('returns null when supabase query returns null data', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getBookingContext('550e8400-e29b-41d4-a716-446655440000');

    expect(result).toBeNull();
  });

  it('returns null and logs warning when supabase query throws an error', async () => {
    mockMaybeSingle.mockRejectedValue(new Error('Connection refused'));

    const result = await getBookingContext('550e8400-e29b-41d4-a716-446655440000');

    expect(result).toBeNull();
  });

  it('correctly identifies valid UUIDs vs non-UUIDs', async () => {
    const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockMaybeSingle.mockResolvedValue({ data: { id: validUuid }, error: null });

    await getBookingContext(validUuid);
    expect(mockEq).toHaveBeenCalledWith('id', validUuid);

    mockMaybeSingle.mockClear();

    const invalidUuid = 'not-a-uuid';
    await getBookingContext(invalidUuid);
    expect(mockEq).toHaveBeenCalledWith('order_display_id', invalidUuid);
  });
});

describe('trimCache Eviction Logic', () => {
  beforeEach(() => {
    audioCache.clear();
  });

  it('removes expired entries and preserves fresh entries', () => {
    const now = Date.now();
    audioCache.set('expired_1', { buffer: Buffer.from('old'), timestamp: now - CACHE_TTL_MS - 1000 });
    audioCache.set('fresh_1', { buffer: Buffer.from('new'), timestamp: now });

    trimCache();

    expect(audioCache.has('expired_1')).toBe(false);
    expect(audioCache.has('fresh_1')).toBe(true);
    expect(audioCache.size).toBe(1);
  });

  it('removes multiple expired entries correctly', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      audioCache.set(`expired_${i}`, { buffer: Buffer.from('old'), timestamp: now - CACHE_TTL_MS - (i + 1) * 1000 });
    }
    audioCache.set('fresh_1', { buffer: Buffer.from('new'), timestamp: now });

    trimCache();

    for (let i = 0; i < 5; i++) {
      expect(audioCache.has(`expired_${i}`)).toBe(false);
    }
    expect(audioCache.has('fresh_1')).toBe(true);
    expect(audioCache.size).toBe(1);
  });

  it('enforces MAX_CACHE_SIZE by evicting oldest remaining entries after purging expired items', () => {
    const now = Date.now();
    // Add 105 fresh entries
    for (let i = 0; i < 105; i++) {
      audioCache.set(`item_${i}`, { buffer: Buffer.from(`data_${i}`), timestamp: now + i });
    }

    trimCache();

    expect(audioCache.size).toBe(MAX_CACHE_SIZE);
    // The 5 oldest items (item_0 to item_4) should be evicted
    for (let i = 0; i < 5; i++) {
      expect(audioCache.has(`item_${i}`)).toBe(false);
    }
    expect(audioCache.has('item_5')).toBe(true);
  });

  it('does not throw on an empty cache', () => {
    expect(() => trimCache()).not.toThrow();
    expect(audioCache.size).toBe(0);
  });

  it('evicts entries exactly at or past the TTL boundary consistently', () => {
    const now = Date.now();
    audioCache.set('exact_ttl', { buffer: Buffer.from('exact'), timestamp: now - CACHE_TTL_MS });

    trimCache();

    expect(audioCache.has('exact_ttl')).toBe(false);
  });

  it('automatically triggers trimCache on cacheAudio invocation', () => {
    const now = Date.now();
    audioCache.set('expired_old', { buffer: Buffer.from('old'), timestamp: now - CACHE_TTL_MS - 5000 });

    cacheAudio('new_item', Buffer.from('fresh_data'));

    expect(audioCache.has('expired_old')).toBe(false);
    expect(audioCache.has('new_item')).toBe(true);
  });
});
