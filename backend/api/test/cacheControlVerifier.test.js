import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const warnMock = vi.fn();

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: warnMock,
  },
}));

import cacheControlVerifier from '../../src/middleware/cacheControlVerifier.js';

function createApp(headers = {}) {
  const app = express();

  app.use((req, res, next) => {
    req.user = { id: 'user-123' };

    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    next();
  });

  app.use(cacheControlVerifier);

  app.get('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  return app;
}

describe('cacheControlVerifier', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    warnMock.mockClear();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('does not warn when recommended cache headers are present', async () => {
    const app = createApp({
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
      Expires: '0',
    });

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns when cache headers are missing', async () => {
    const app = createApp();

    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);

    expect(warnMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      path: '/test',
    });

    expect(warnMock.mock.calls[0][1]).toBe(
      'Authenticated response may be cacheable'
    );
  });

  it('warns when Cache-Control is cacheable', async () => {
    const app = createApp({
      'Cache-Control': 'public, max-age=3600',
      Pragma: 'no-cache',
      Expires: '0',
    });

    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('does not warn in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp();

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });
});