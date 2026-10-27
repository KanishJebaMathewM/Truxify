import { describe, it, expect, vi, afterEach } from 'vitest';

const createClient = vi.hoisted(() => vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

describe('locationService Supabase configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects anon-only configuration instead of creating a fallback client', async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key-that-must-not-be-used');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    const mod = await import('../../src/services/locationService.js');

    await expect(
      mod.updateDriverLocation('driver-1', 77.5, 12.5, { bypassAnomalyCheck: true })
    ).rejects.toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);

    expect(createClient).not.toHaveBeenCalled();
  });
});
