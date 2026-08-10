import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import securityHeaders from '../../src/middleware/securityHeaders.js';

function createApp(preset = {}) {
  const app = express();

  app.use((req, res, next) => {
    for (const [name, value] of Object.entries(preset)) {
      res.setHeader(name, value);
    }
    next();
  });

  app.use(securityHeaders);

  app.get('/test', (req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

describe('securityHeaders', () => {
  it('sets the baseline security headers on a plain request', async () => {
    const res = await request(createApp()).get('/test');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe(
      'geolocation=(self), camera=(self), microphone=(self)'
    );
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-content-security-policy']).toBe("default-src 'self'");
  });

  it('does not send HSTS over plain HTTP', async () => {
    const res = await request(createApp()).get('/test');

    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('sends HSTS when the request arrived over HTTPS at the proxy', async () => {
    const res = await request(createApp())
      .get('/test')
      .set('x-forwarded-proto', 'https');

    expect(res.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains'
    );
  });

  it('preserves headers an earlier layer already set', async () => {
    const res = await request(
      createApp({
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
    ).get('/test');

    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    // The headers nobody set are still filled in.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('never overrides an existing Content-Security-Policy', async () => {
    const csp = "default-src 'none'; script-src 'self'";
    const res = await request(createApp({ 'Content-Security-Policy': csp })).get('/test');

    expect(res.headers['content-security-policy']).toBe(csp);
  });

  it('does not set a Content-Security-Policy of its own', async () => {
    const res = await request(createApp()).get('/test');

    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('calls next() so the request reaches the route', async () => {
    const res = await request(createApp()).get('/test');

    expect(res.body).toEqual({ ok: true });
  });
});
