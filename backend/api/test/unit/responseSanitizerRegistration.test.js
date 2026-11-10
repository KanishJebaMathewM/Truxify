import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import responseSanitizer from '../../src/middleware/responseSanitizer.js';

// Replay the relevant real bootstrap registrations, without starting the API's
// database connections, background workers or listener. Fixtures stand in for
// response producers; sanitization itself runs through real Express res.json.
const source = readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8');
const registration = text => {
  const offset = source.indexOf(text);
  if (offset < 0) throw new Error(`Missing bootstrap registration: ${text}`);
  return offset;
};
const payload = { ok: false, _internal: 'private', rows: [{ id: 7, _debug: 'private', _metadata: { hidden: true } }] };
const clean = { ok: false, rows: [{ id: 7 }] };
function application() {
  const app = express();
  const stages = [
    ['app.use(responseSanitizer)', responseSanitizer],
    ['app.use(headerSizeMonitor)', (req, res, next) => req.path === '/early-error' ? res.status(431).json(payload) : next()],
    ["app.use('/api', verifyJWT)", (req, res, next) => req.path === '/auth-error' ? res.status(401).json(payload) : next()],
    ["app.use('/api', requestCacheMiddleware)", (req, res, next) => req.path === '/cached' ? res.json(payload) : next()],
    ["app.use('/api/driver', driverRoutes)", (req, res, next) => req.path === '/route' ? res.json(payload) : next()],
    ['app.use(notFound)', (_req, res) => res.status(404).json(payload)],
  ];
  stages.sort((a, b) => registration(a[0]) - registration(b[0]));
  for (const [, middleware] of stages) app.use(middleware);
  return app;
}

describe('response sanitization in the API bootstrap order', () => {
  it.each([
    ['/route', 200], ['/cached', 200], ['/auth-error', 401], ['/early-error', 431], ['/missing', 404],
  ])('sanitizes %s responses before sending JSON', async (path, status) => {
    const response = await request(application()).get(path);
    expect(response.status).toBe(status);
    expect(response.body).toEqual(clean);
  });
  it('registers the sanitizer once before every route and response-producing middleware', () => {
    expect(source.match(/app\.use\(responseSanitizer\)/g)).toHaveLength(1);
    const sanitizer = registration('app.use(responseSanitizer)');
    const mounts = [...source.matchAll(/app\.(?:use|get|post|put|patch|delete|all)\(/g)]
      .map(match => match.index).filter(offset => offset !== sanitizer);
    expect(mounts.every(offset => offset > sanitizer)).toBe(true);
  });
});
