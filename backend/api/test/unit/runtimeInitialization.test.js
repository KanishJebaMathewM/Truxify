import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

describe('API runtime supports Supabase without a WebSocket polyfill', () => {
  it('initializes the same default realtime transport used by database clients', () => {
    expect(typeof globalThis.WebSocket).toBe('function');
    const client = createClient('https://runtime-test.invalid', 'test-only-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(client.realtime).toBeDefined();
  });

  it('executes a Data API query with native runtime capabilities', async () => {
    const transport = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { 'content-range': '*/7' },
    }));
    const client = createClient('https://runtime-test.invalid', 'test-only-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: transport },
    });
    const result = await client.from('orders').select('id', { count: 'exact', head: true });
    expect(result.error).toBeNull();
    expect(result.count).toBe(7);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1].method).toBe('HEAD');
  });
});
