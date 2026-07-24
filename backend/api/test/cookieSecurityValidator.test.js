import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const warnMock = vi.fn();

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: warnMock,
  },
}));

import cookieSecurityValidator from '../../src/middleware/cookieSecurityValidator.js';

function createApp(setCookieValue) {
  const app = express();

  app.use(cookieSecurityValidator);

  app.get('/test', (req, res) => {
    if (setCookieValue) {
      res.setHeader('Set-Cookie', setCookieValue);
    }

    res.status(200).json({ success: true });
  });

  return app;
}

describe('cookieSecurityValidator', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    warnMock.mockClear();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('does not log when no cookies are set', async () => {
    const app = createApp(null);

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does not log when all recommended attributes are present', async () => {
    const app = createApp(
      'session=abc123; HttpOnly; SameSite=Lax; Path=/'
    );

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('logs warning when security attributes are missing', async () => {
    const app = createApp('session=abc123');

    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);

    expect(warnMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      path: '/test',
      missingAttributes: expect.arrayContaining([
        'HttpOnly',
        'SameSite',
        'Path',
      ]),
    });

    expect(warnMock.mock.calls[0][1]).toBe(
      'Cookie missing recommended security attributes'
    );
  });

  it('does not log warnings in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp('session=abc123');

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });
});