import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import logger from '../../src/middleware/logger.js';
import cacheControlVerifier from '../../src/middleware/cacheControlVerifier.js';

function makeApp(handler, setUser = true) {
  const app = express();
  app.use((req, _res, next) => {
    if (setUser) {
      req.user = { id: 'user-1' };
    }
    next();
  });
  app.use(cacheControlVerifier);
  app.get('/test', handler);
  return app;
}

describe('cacheControlVerifier middleware extended coverage', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('bypasses check when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';
    const app = makeApp((_req, res) => {
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not log warnings when request is unauthenticated (req.user is missing)', async () => {
    const app = makeApp((_req, res) => {
      res.json({ success: true }); // No caching headers, but unauthenticated
    }, false);

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when Cache-Control, Pragma, or Expires headers are completely missing', async () => {
    const app = makeApp((_req, res) => {
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalled();
    const warningArg = logger.warn.mock.calls[0][0];
    expect(warningArg.missingHeaders).toContain('Cache-Control');
    expect(warningArg.missingHeaders).toContain('Pragma');
    expect(warningArg.missingHeaders).toContain('Expires');
  });

  it('warns when Cache-Control is present but lacks secure directives (no-store, no-cache, private)', async () => {
    const app = makeApp((_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalled();
    const warningArg = logger.warn.mock.calls[0][0];
    expect(warningArg.missingHeaders).toContain('Cache-Control policy');
  });

  it('warns specifically when Pragma header is missing', async () => {
    const app = makeApp((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Expires', '0');
      // Pragma omitted
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalled();
    const warningArg = logger.warn.mock.calls[0][0];
    expect(warningArg.missingHeaders).toEqual(['Pragma']);
  });

  it('warns specifically when Expires header is missing', async () => {
    const app = makeApp((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      // Expires omitted
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalled();
    const warningArg = logger.warn.mock.calls[0][0];
    expect(warningArg.missingHeaders).toEqual(['Expires']);
  });

  it('passes without warning when valid cache-control (no-store) and all headers are present', async () => {
    const app = makeApp((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes without warning when valid cache-control (no-cache) and all headers are present', async () => {
    const app = makeApp((_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes without warning when valid cache-control (private) and all headers are present', async () => {
    const app = makeApp((_req, res) => {
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json({ success: true });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
