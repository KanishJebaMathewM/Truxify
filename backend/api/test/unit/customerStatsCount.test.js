import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  admin: null, fallback: null,
  cachedStats: vi.fn(), cacheStats: vi.fn(),
}));
vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return fixtures.admin; },
  get supabase() { return fixtures.fallback; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/lib/profileCache.js', () => ({
  getCachedCustomerStats: fixtures.cachedStats,
  setCachedCustomerStats: fixtures.cacheStats,
  getCachedSupabaseProfile: vi.fn(), setCachedSupabaseProfile: vi.fn(),
  getCachedDriverDetails: vi.fn(), setCachedDriverDetails: vi.fn(),
  isValidCachedProfile: vi.fn(),
}));

import { getCustomerStats } from '../../src/services/profileService.js';

describe('customer order totals beyond the Data API row cap', () => {
  let transport;
  let counts;
  beforeEach(() => {
    vi.clearAllMocks();
    // The repository's Node 20 CI has no native WebSocket. Realtime remains
    // unused, but Supabase initializes its transport when constructing a client.
    vi.stubGlobal('WebSocket', undefined);
    vi.stubEnv('CACHE_ENABLED', 'false');
    fixtures.cachedStats.mockResolvedValue(null);
    fixtures.cacheStats.mockResolvedValue(undefined);
    counts = { 'customer-a': 1503, 'customer-b': 7, 'customer-empty': 0 };
    transport = vi.fn(async (address, options) => {
      const url = new URL(address);
      const customer = url.searchParams.get('customer_id')?.replace(/^eq\./, '');
      const count = counts[customer] ?? 0;
      const headers = { 'content-type': 'application/json', 'content-range': `*/${count}` };
      if (options.method === 'HEAD') return new Response(null, { status: 200, headers });
      // Model the normal Data API result cap, independently of the exact total.
      const rows = Array.from({ length: Math.min(count, 1000) }, () => ({ status: 'delivered', total_amount: 100 }));
      return new Response(JSON.stringify(rows), { status: 200, headers });
    });
    const client = createClient('https://count-test.invalid', 'test-only-key', {
      global: { fetch: transport },
      realtime: { transport: WebSocket },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    fixtures.admin = client;
    fixtures.fallback = client;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('counts every customer order beyond the default 1000-row cap', async () => {
    expect((await getCustomerStats('customer-a')).total_orders).toBe(1503);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('uses a count-only request with the customer predicate', async () => {
    await getCustomerStats('customer-a');
    const [address, options] = transport.mock.calls[0];
    const url = new URL(address);
    expect(options.method).toBe('HEAD');
    expect(new Headers(options.headers).get('prefer')).toContain('count=exact');
    expect(url.pathname).toBe('/rest/v1/orders');
    expect(url.searchParams.get('customer_id')).toBe('eq.customer-a');
    expect(url.searchParams.get('select')).toBe('id');
  });

  it('keeps totals scoped to each customer', async () => {
    expect((await getCustomerStats('customer-a')).total_orders).toBe(1503);
    expect((await getCustomerStats('customer-b')).total_orders).toBe(7);
  });

  it('preserves the empty-customer response', async () => {
    expect(await getCustomerStats('customer-empty')).toEqual({
      user_id: 'customer-empty', total_orders: 0, total_saved: 0, co2_reduced_kg: 0,
    });
  });

  it('returns an existing cached result without a database request', async () => {
    vi.stubEnv('CACHE_ENABLED', 'true');
    const cached = { user_id: 'customer-a', total_orders: 1503, total_saved: 0, co2_reduced_kg: 0 };
    fixtures.cachedStats.mockResolvedValue(cached);
    expect(await getCustomerStats('customer-a')).toBe(cached);
    expect(transport).not.toHaveBeenCalled();
  });

  it('caches the exact count after a cache miss', async () => {
    vi.stubEnv('CACHE_ENABLED', 'true');
    const result = await getCustomerStats('customer-a');
    expect(fixtures.cacheStats).toHaveBeenCalledWith('customer-a', result);
    expect(result.total_orders).toBe(1503);
  });

  it('preserves query error propagation and avoids caching failures', async () => {
    vi.stubEnv('CACHE_ENABLED', 'true');
    transport.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }));
    await expect(getCustomerStats('customer-a')).rejects.toMatchObject({ message: expect.any(String) });
    expect(fixtures.cacheStats).not.toHaveBeenCalled();
  });

  it('uses the existing fallback client when the admin client is unavailable', async () => {
    fixtures.admin = null;
    expect((await getCustomerStats('customer-a')).total_orders).toBe(1503);
  });
});
