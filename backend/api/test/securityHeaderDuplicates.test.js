import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const warnMock = vi.fn();

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: warnMock,
  },
}));

import securityHeaderDuplicates from '../../src/middleware/securityHeaderDuplicates.js';

function createApp(handler) {
  const app = express();

  app.use(securityHeaderDuplicates);

  app.get('/test', handler);

  return app;
}

describe('securityHeaderDuplicates', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    warnMock.mockClear();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('does not warn when a monitored header is set once', async () => {
    const app = createApp((req, res) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.send('ok');
    });

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns when a monitored header is set twice', async () => {
    const app = createApp((req, res) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.send('ok');
    });

    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);

    expect(warnMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      path: '/test',
      header: 'x-frame-options',
    });

    expect(warnMock.mock.calls[0][1]).toBe(
      'Duplicate security header assignment detected'
    );
  });

  it('does not warn for non-security headers', async () => {
    const app = createApp((req, res) => {
      res.setHeader('X-Test', '1');
      res.setHeader('X-Test', '2');
      res.send('ok');
    });

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does not warn in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp((req, res) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.send('ok');
    });

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });
});