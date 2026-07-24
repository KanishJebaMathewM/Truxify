import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const warnMock = vi.fn();

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: warnMock,
  },
}));

import securityHeadersVerifier from '../../src/middleware/securityHeadersVerifier.js';

function createApp(setHeaders = true) {
  const app = express();

  app.use((req, res, next) => {
    if (setHeaders) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=()');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    next();
  });

  app.use(securityHeadersVerifier);

  app.get('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  return app;
}

describe('securityHeadersVerifier', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    warnMock.mockClear();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('does not log warnings when all required headers are present', async () => {
    const app = createApp(true);

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('logs warnings when required headers are missing', async () => {
    const app = createApp(false);

    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);

    expect(warnMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      path: '/test',
    });

    expect(warnMock.mock.calls[0][1]).toBe(
      'Missing expected security headers'
    );
  });

  it('does not log warnings in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp(false);

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });
});