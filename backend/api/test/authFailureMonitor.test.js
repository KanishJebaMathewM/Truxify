import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const warnMock = vi.fn();

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: warnMock,
  },
}));

import authFailureMonitor from '../../src/middleware/authFailureMonitor.js';

function createApp(statusCode = 401) {
  const app = express();

  app.use((req, res, next) => {
    req.ip = '127.0.0.1';
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
    const app = createApp(401);

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
    const app = createApp(403);

    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('ignores successful responses', async () => {
    const app = createApp(200);

    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });

  it('does not run in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = createApp(401);

    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    expect(warnMock).not.toHaveBeenCalled();
  });
});