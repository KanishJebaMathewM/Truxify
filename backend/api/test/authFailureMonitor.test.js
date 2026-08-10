import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock('../src/middleware/logger.js', () => ({
  default: {
    warn: warnMock,
  },
}));

import authFailureMonitor from '../src/middleware/authFailureMonitor.js';

// The middleware keys its failure counters by IP in a module-level Map that
// lives for the whole file, so every test needs its own IP to stay isolated.
function createApp(statusCode = 401, ip = '127.0.0.1') {
  const app = express();

  app.use((req, res, next) => {
    // `req.ip` is a getter-only accessor on the Express prototype; a plain
    // assignment throws in strict mode, which would 500 the request before it
    // ever reached the monitor.
    Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    next();
  });

  app.use(authFailureMonitor);

  app.get('/test', (req, res) => {
    res.status(statusCode).json({ success: false });
  });

  return app;
}

describe('authFailureMonitor', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalThreshold = process.env.AUTH_FAILURE_THRESHOLD;
  const originalWindow = process.env.AUTH_FAILURE_WINDOW_MS;

  beforeEach(() => {
    warnMock.mockClear();
    process.env.NODE_ENV = 'development';
    process.env.AUTH_FAILURE_THRESHOLD = '3';
    process.env.AUTH_FAILURE_WINDOW_MS = '60000';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.AUTH_FAILURE_THRESHOLD = originalThreshold;
    process.env.AUTH_FAILURE_WINDOW_MS = originalWindow;
  });

  it('does not warn before the threshold is reached', async () => {
    const app = createApp(401, '10.0.0.1');

    await request(app).get('/test');
    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns after repeated authentication failures', async () => {
    const app = createApp(401);

    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);

    expect(warnMock.mock.calls[0][0]).toMatchObject({
      ip: '127.0.0.1',
      method: 'GET',
      path: '/test',
      statusCode: 401,
      failureCount: 3,
    });

    expect(warnMock.mock.calls[0][1]).toBe(
      'Repeated authentication failures detected'
    );
  });

  it('tracks 403 responses as authentication failures', async () => {
    const app = createApp(403, '10.0.0.3');

    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('ignores successful responses', async () => {
    const app = createApp(200, '10.0.0.4');

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does not run in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp(401, '10.0.0.5');

    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });
});
