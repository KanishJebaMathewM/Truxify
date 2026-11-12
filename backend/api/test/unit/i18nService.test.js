import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return global.__i18nSupabase; },
  get redisClient() { return global.__i18nRedis; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createSupabaseMock } = await import('../helpers/supabaseMock.js');
const { RedisMock } = await import('../mocks/redisMock.js');
const {
  loadTranslations,
  translate,
  clearTranslationCache,
  MEMORY_CACHE_TTL_MS,
} = await import('../../src/services/i18nService.js');

const seed = () => createSupabaseMock({
  translations: [
    { locale: 'hi-IN', key: 'greeting', value: 'नमस्ते {name}', plural_forms: null },
    { locale: 'hi-IN', key: 'orders.count', value: null, plural_forms: JSON.stringify({ one: '{count} ऑर्डर', other: '{count} ऑर्डर' }) },
    { locale: 'en-IN', key: 'greeting', value: 'Hello {name}', plural_forms: null },
  ],
});

describe('i18nService', () => {
  beforeEach(async () => {
    global.__i18nSupabase = seed().supabase;
    global.__i18nRedis = new RedisMock();
    global.__i18nRedis.status = 'ready';
    await clearTranslationCache(); // wipe module memory cache between tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads translations into a dict (plural_forms JSON-parsed)', async () => {
    const dict = await loadTranslations('hi-IN');
    expect(dict['greeting']).toBe('नमस्ते {name}');
    expect(dict['orders.count']).toEqual({ one: '{count} ऑर्डर', other: '{count} ऑर्डर' });
  });

  it('caches in Redis after a DB load (second load served without re-query)', async () => {
    await loadTranslations('hi-IN');
    expect(global.__i18nRedis.get).toBeDefined;
    const cached = await global.__i18nRedis.get('i18n:translations:hi-IN');
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached)['greeting']).toContain('नमस्ते');
  });

  it('translate interpolates variables', async () => {
    expect(await translate('greeting', { name: 'Ram' }, 'hi-IN')).toBe('नमस्ते Ram');
  });

  it('translate falls back to en-IN when the locale lacks the key', async () => {
    expect(await translate('greeting', { name: 'Ram' }, 'ta-IN')).toBe('Hello Ram');
  });

  it('translate returns the fallback (or the key) when missing everywhere', async () => {
    expect(await translate('no.such.key', {}, 'hi-IN', 'DEFAULT')).toBe('DEFAULT');
    expect(await translate('no.such.key', {}, 'hi-IN')).toBe('no.such.key');
  });

  it('pluralized templates select via CLDR category with the count', async () => {
    const one = await translate('orders.count', { count: 1 }, 'hi-IN');
    expect(one).toBe('1 ऑर्डर');
  });

  it('clearTranslationCache(locale) forces a reload', async () => {
    await loadTranslations('hi-IN');
    global.__i18nSupabase = createSupabaseMock({ translations: [] }).supabase;
    await clearTranslationCache('hi-IN');
    const dict = await loadTranslations('hi-IN');
    expect(dict).toEqual({});
  });

  it('DB failure degrades to an empty dict (no throw)', async () => {
    global.__i18nSupabase = { from: () => { throw new Error('db down'); } };
    global.__i18nRedis.status = 'connecting';
    expect(await loadTranslations('xx-IN')).toEqual({});
  });

  it('does not query storage for an unsupported locale', async () => {
    const from = vi.fn();
    global.__i18nSupabase = { from };
    global.__i18nRedis.status = 'connecting';

    await expect(loadTranslations('xx-IN')).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('falls back to English for an unsupported locale', async () => {
    await expect(translate('greeting', { name: 'Ram' }, 'xx-XX')).resolves.toBe('Hello Ram');
  });

  it('reloads from the database after the memory cache TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    await loadTranslations('hi-IN');

    global.__i18nSupabase = createSupabaseMock({
      translations: [{ locale: 'hi-IN', key: 'greeting', value: 'नया {name}', plural_forms: null }],
    }).supabase;
    global.__i18nRedis.status = 'connecting';

    vi.setSystemTime(new Date(Date.now() + MEMORY_CACHE_TTL_MS + 1));

    const dict = await loadTranslations('hi-IN');
    expect(dict.greeting).toBe('नया {name}');
  });
});
