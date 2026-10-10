import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ client: null }));
vi.mock('../../src/config/db.js', () => ({ get supabaseAdmin() { return db.client; } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { getNearbyGripData } from '../../src/controllers/roadConditionController.js';

const reports = [
  { id: 'east', latitude: 0, longitude: 179.95 },
  { id: 'west', latitude: 0, longitude: -179.95 },
  { id: 'north', latitude: 89.95, longitude: 170 },
  { id: 'south', latitude: -89.95, longitude: -170 },
  { id: 'ordinary', latitude: 28.6, longitude: 77.2 },
  { id: 'far', latitude: 0, longitude: 0 },
];

describe('nearby road grip searches across geographic boundaries', () => {
  let transport;
  let address;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    transport = vi.fn(async url => {
      address = new URL(url);
      // Evaluate the actual PostgREST URL filters over a controlled report set.
      const matches = reports.filter(row => {
        for (const field of ['latitude', 'longitude']) {
          for (const filter of address.searchParams.getAll(field)) {
            const separator = filter.indexOf('.');
            const op = filter.slice(0, separator);
            const bound = Number(filter.slice(separator + 1));
            if (op === 'gte' && row[field] < bound) return false;
            if (op === 'lte' && row[field] > bound) return false;
          }
        }
        const wrapped = address.searchParams.get('or');
        if (wrapped) {
          const bounds = wrapped.match(/longitude\.gte\.(-?[\d.]+),longitude\.lte\.(-?[\d.]+)/);
          if (!bounds) throw new Error('Unexpected longitude expression');
          if (row.longitude < Number(bounds[1]) && row.longitude > Number(bounds[2])) return false;
        }
        return true;
      });
      return new Response(JSON.stringify(matches), { headers: { 'content-type': 'application/json' } });
    });
    db.client = createClient('https://grip-test.invalid', 'test-only-key', {
      global: { fetch: transport }, realtime: { transport: WebSocket },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });
  afterEach(() => vi.useRealTimers());

  async function nearby(lat, lng, radius_miles = 20) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await getNearbyGripData({ query: { lat, lng, radius_miles } }, res);
    return res;
  }

  it.each([179.9, -179.9])('includes reports on both sides of longitude %s', async lng => {
    const res = await nearby(0, lng);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [reports[0], reports[1]] });
    expect(address.searchParams.get('or')).toBeTruthy();
    expect(address.searchParams.getAll('longitude')).toHaveLength(0);
  });

  it.each([[89.9, 'north'], [-89.9, 'south']])('does not exclude other longitudes when the cap touches latitude %s', async (lat, id) => {
    const res = await nearby(lat, 0);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: reports.filter(row => row.id === id) });
    expect(address.searchParams.getAll('longitude')).toEqual(['gte.-180', 'lte.180']);
  });

  it('keeps ordinary bounds, recency, ordering and the result limit', async () => {
    const res = await nearby(28.6, 77.2);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [reports[4]] });
    expect(address.searchParams.has('or')).toBe(false);
    expect(address.searchParams.get('recorded_at')).toBe('gte.2026-10-06T00:00:00.000Z');
    expect(address.searchParams.get('order')).toBe('recorded_at.desc');
    expect(address.searchParams.get('limit')).toBe('100');
  });

  it('rejects invalid coordinates before contacting the database', async () => {
    const res = await nearby(91, 0);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(transport).not.toHaveBeenCalled();
  });
});
