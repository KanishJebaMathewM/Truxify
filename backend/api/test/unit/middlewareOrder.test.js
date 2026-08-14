/**
 * Guards the registration order of the Express middleware chain.
 *
 * Express matches middleware positionally, so mounting a router before the
 * security stack silently disables it for that path — no error, no warning.
 * `/api/earnings` was registered ahead of the body parsers, HPP protection,
 * content-type enforcement, fraud detection and the rate limiter, which meant
 * every request to it bypassed all of them.
 *
 * These assertions read src/index.js as text rather than booting the app,
 * because importing it starts servers, workers and reconciliation cron jobs.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX = path.resolve(__dirname, '../../src/index.js');

/** Middleware every /api route must sit behind, with the marker that registers it. */
const REQUIRED_BEFORE_ROUTES = [
  { name: 'JSON body parser', marker: 'express.json(' },
  { name: 'urlencoded body parser', marker: 'express.urlencoded(' },
  { name: 'correlation ID', marker: 'app.use(correlationIdMiddleware)' },
  { name: 'request ID', marker: 'app.use(requestIdMiddleware)' },
  { name: 'request logger', marker: 'app.use(requestLogger)' },
  { name: 'HPP protection', marker: 'app.use(hppProtection)' },
  { name: 'suspicious requests', marker: 'app.use(suspiciousRequests)' },
  { name: 'content-type enforcement', marker: 'app.use(requireJsonContent)' },
  // Fraud detection is deliberately registered per-route (after authenticate)
  // for the high-value orders/payments/trips routers — see #6321 — so the
  // marker locks in that mount rather than a global registration.
  { name: 'fraud detection', marker: "app.use('/api/orders', fraudDetectionMiddleware" },
  { name: 'global rate limiter', marker: "app.use('/api/', globalLimiter)" },
];

describe('express middleware registration order', () => {
  let source;

  beforeAll(async () => {
    source = await fs.readFile(INDEX, 'utf8');
  });

  it('registers every security middleware exactly once', () => {
    for (const { name, marker } of REQUIRED_BEFORE_ROUTES) {
      const occurrences = source.split(marker).length - 1;
      expect(occurrences, `${name} should be registered exactly once`).toBe(1);
    }
  });

  it('mounts /api/earnings behind the full middleware chain', () => {
    const mount = source.indexOf("app.use('/api/earnings'");
    expect(mount, '/api/earnings should be mounted').toBeGreaterThan(-1);

    for (const { name, marker } of REQUIRED_BEFORE_ROUTES) {
      const registered = source.indexOf(marker);
      expect(registered, `${name} should be registered`).toBeGreaterThan(-1);
      expect(
        registered,
        `/api/earnings is mounted before ${name} — that path would bypass it`
      ).toBeLessThan(mount);
    }
  });

  it('mounts no /api router ahead of the global rate limiter', () => {
    const limiter = source.indexOf("app.use('/api/', globalLimiter)");
    expect(limiter).toBeGreaterThan(-1);

    // Health is deliberately mounted earlier with its own dedicated limiter
    // so uptime probes are not throttled by the global bucket.
    const ALLOWED_BEFORE_LIMITER = ['/api/health', '/api/v1/health'];

    const earlyMounts = [...source.slice(0, limiter).matchAll(/app\.use\(\s*'(\/api[^']*)'/g)]
      .map((match) => match[1])
      .filter((route) => !ALLOWED_BEFORE_LIMITER.includes(route));

    expect(
      earlyMounts,
      `These /api routers are mounted before the global rate limiter and bypass it: ${earlyMounts.join(', ')}`
    ).toEqual([]);
  });

  it('keeps the earnings mount alongside the other REST routes', () => {
    const earnings = source.indexOf("app.use('/api/earnings'");
    const orders = source.indexOf("app.use('/api/orders', orderRoutes)");
    const profile = source.indexOf("app.use('/api/profile'");

    expect(earnings).toBeGreaterThan(orders);
    expect(earnings).toBeLessThan(profile);
  });
});

describe('earnings route protection', () => {
  let source;

  beforeAll(async () => {
    source = await fs.readFile(
      path.resolve(__dirname, '../../routes/earnings.js'),
      'utf8'
    );
  });

  it('requires authentication', () => {
    expect(source).toMatch(/authenticate/);
  });

  it('enforces the driver earnings policy', () => {
    expect(source).toMatch(/requirePolicy\(\s*['"]driver:view-earnings['"]\s*\)/);
  });

  it('applies a per-user rate limit', () => {
    expect(source).toMatch(/userLimiter/);
  });

  it('validates the query string', () => {
    expect(source).toMatch(/validateQuery\(\s*earningsSummarySchema\s*\)/);
  });

  it('reads the driver id from the authenticated user, not a placeholder', () => {
    expect(source).toMatch(/req\.user\.id/);
    expect(source).not.toMatch(/demo-driver/);
    expect(source).not.toMatch(/req\.user\?\.id\s*\?\?/);
  });

  it('no longer serves hardcoded mock trips', () => {
    expect(source).not.toMatch(/mockTrips/);
    expect(source).not.toMatch(/trip_001/);
  });

  it('uses the project logger rather than console', () => {
    expect(source).toMatch(/logger\.error/);
    expect(source).not.toMatch(/console\.(error|log)/);
  });

  it('bounds the trips query', () => {
    expect(source).toMatch(/\.limit\(\s*MAX_TRIPS_PER_SUMMARY\s*\)/);
  });
});
