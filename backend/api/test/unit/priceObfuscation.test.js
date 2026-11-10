import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return global.__poSupabase; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createSupabaseMock } = await import('../../test/helpers/supabaseMock.js');
const { applyPriceObfuscation } = await import('../../src/services/priceObfuscation.js');

describe('applyPriceObfuscation', () => {
  beforeEach(() => { global.__poSupabase = null; });

  it('anonymous users get ±1% noise (baseline-scraping deterrence)', async () => {
    const results = new Set();
    for (let i = 0; i < 40; i++) results.add(await applyPriceObfuscation(10000, null));
    for (const p of results) {
      expect(Math.abs(p - 10000) / 10000).toBeLessThanOrEqual(0.011);
      expect(p).toBeGreaterThanOrEqual(9000); // the 0.9 floor
    }
    expect(results.size).toBeGreaterThan(1, 'noise must actually randomize');
  });

  it('normal-conversion users get the exact price back', async () => {
    const mock = createSupabaseMock({
      user_ml_metrics: [{ user_id: 'good-user', total_searches: 20, total_bookings: 15, updated_at: new Date().toISOString() }],
    });
    global.__poSupabase = mock.supabase;
    expect(await applyPriceObfuscation(50000, 'good-user')).toBe(50000);
  });

  it('frequent searchers below the conversion threshold get 1–2% noise', async () => {
    const mock = createSupabaseMock({
      user_ml_metrics: [{ user_id: 'scraper', total_searches: 50, total_bookings: 2, updated_at: new Date().toISOString() }],
    });
    global.__poSupabase = mock.supabase;
    const results = new Set();
    for (let i = 0; i < 40; i++) results.add(await applyPriceObfuscation(20000, 'scraper'));
    for (const p of results) {
      const drift = Math.abs(p - 20000) / 20000;
      expect(drift).toBeGreaterThan(0.005);
      expect(drift).toBeLessThanOrEqual(0.021);
    }
  });

  it('infrequent searchers are never noised even at zero bookings', async () => {
    const mock = createSupabaseMock({
      user_ml_metrics: [{ user_id: 'rare', total_searches: 3, total_bookings: 0, updated_at: new Date().toISOString() }],
    });
    global.__poSupabase = mock.supabase;
    expect(await applyPriceObfuscation(30000, 'rare')).toBe(30000);
  });

  it('metrics lookup failure fails safe to the exact price (never blocks pricing)', async () => {
    const mock = createSupabaseMock({});
    mock.supabase.from = () => { throw new Error('db down'); };
    global.__poSupabase = mock.supabase;
    expect(await applyPriceObfuscation(15000, 'unlucky')).toBe(15000);
  });

  it('prices are rounded to 2 decimal places', async () => {
    const p = await applyPriceObfuscation(10000.005, null);
    expect(Number.isInteger(p * 100)).toBe(true);
  });
});
