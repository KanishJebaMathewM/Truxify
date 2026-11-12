import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const i18nServiceMock = vi.hoisted(() => ({
  translate: vi.fn(),
  loadTranslations: vi.fn(),
  clearTranslationCache: vi.fn(),
}));

vi.mock('../../src/services/i18nService.js', () => i18nServiceMock);
vi.mock('../../src/config/db.js', () => ({ supabaseAdmin: {} }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const { default: i18nRouter } = await import('../../src/routes/i18nRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/i18n', i18nRouter);
  return app;
}

describe('i18nRoutes public translation endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates a supported locale', async () => {
    i18nServiceMock.translate.mockResolvedValue('नमस्ते Ram');

    const res = await request(makeApp())
      .post('/api/i18n/translate')
      .send({ key: 'greeting', variables: { name: 'Ram' }, locale: 'hi-IN' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      key: 'greeting',
      locale: 'hi-IN',
      translated: 'नमस्ते Ram',
    });
    expect(i18nServiceMock.translate).toHaveBeenCalledWith('greeting', { name: 'Ram' }, 'hi-IN');
  });

  it('defaults to en-IN when no locale is supplied', async () => {
    i18nServiceMock.translate.mockResolvedValue('Hello');

    const res = await request(makeApp())
      .post('/api/i18n/translate')
      .send({ key: 'greeting' });

    expect(res.status).toBe(200);
    expect(i18nServiceMock.translate).toHaveBeenCalledWith('greeting', {}, 'en-IN');
  });

  it('rejects an unsupported locale before cache or database work', async () => {
    const res = await request(makeApp())
      .post('/api/i18n/translate')
      .send({ key: 'greeting', locale: 'xx-XX' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unsupported locale');
    expect(i18nServiceMock.translate).not.toHaveBeenCalled();
  });

  it('rejects a non-string or oversized key', async () => {
    for (const key of ['', '   ', 42, 'x'.repeat(257)]) {
      const res = await request(makeApp())
        .post('/api/i18n/translate')
        .send({ key, locale: 'en-IN' });

      expect(res.status).toBe(400);
    }
    expect(i18nServiceMock.translate).not.toHaveBeenCalled();
  });

  it('rejects an unsupported locale on the translations route', async () => {
    const res = await request(makeApp()).get('/api/i18n/translations/xx-IN');

    expect(res.status).toBe(400);
    expect(i18nServiceMock.loadTranslations).not.toHaveBeenCalled();
  });

  it('returns a supported locale translation dictionary', async () => {
    i18nServiceMock.loadTranslations.mockResolvedValue({ greeting: 'Hello' });

    const res = await request(makeApp()).get('/api/i18n/translations/en-IN');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      locale: 'en-IN',
      translations: { greeting: 'Hello' },
    });
  });
});
