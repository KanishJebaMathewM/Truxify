import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const warnMock = vi.fn();

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: warnMock,
  },
}));

import headerSizeMonitor from '../../src/middleware/headerSizeMonitor.js';

function createApp(headers = {}) {
  const app = express();

  app.use((req, res, next) => {
    Object.assign(req.headers, headers);
    next();
  });

  app.use(headerSizeMonitor);

  app.get('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  return app;
}

describe('headerSizeMonitor', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalLimit = process.env.HEADER_SIZE_LIMIT;

  beforeEach(() => {
    warnMock.mockClear();
    process.env.NODE_ENV = 'development';
    process.env.HEADER_SIZE_LIMIT = '100';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;

    if (originalLimit === undefined) {
      delete process.env.HEADER_SIZE_LIMIT;
    } else {
      process.env.HEADER_SIZE_LIMIT = originalLimit;
    }
  });

  it('does not log when request headers are below the limit', async () => {
    const app = createApp({
      'x-test': 'small-header',
    });

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('logs a warning when request headers exceed the configured limit', async () => {
    const app = createApp({
      authorization: 'Bearer ' + 'x'.repeat(300),
    });

    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);

    expect(warnMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      path: '/test',
      limit: 100,
    });

    expect(warnMock.mock.calls[0][1]).toBe(
      'Request headers exceed configured size threshold'
    );
  });

  it('supports custom size limits', async () => {
    process.env.HEADER_SIZE_LIMIT = '1000';

    const app = createApp({
      authorization: 'Bearer ' + 'x'.repeat(300),
    });

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does not log warnings in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp({
      authorization: 'Bearer ' + 'x'.repeat(500),
    });

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });
});