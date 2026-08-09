/**
 * Coverage for HTTP response compression.
 *
 * Neither the Express app nor nginx compressed anything, so every API
 * response shipped raw to drivers on metered mobile data.
 */
import express from 'express';
import request from 'supertest';
import http from 'http';
import zlib from 'zlib';
import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_LEVEL,
  COMPRESSION_THRESHOLD_BYTES,
  compressionMiddleware,
  shouldCompress,
} from '../../src/config/compression.js';

/** Build a response object exposing just the getHeader shape the filter uses. */
function res(contentType) {
  return {
    getHeader: (name) =>
      name.toLowerCase() === 'content-type' ? contentType : undefined,
  };
}

function req(headers = {}) {
  return { headers, method: 'GET', url: '/' };
}

/** A realistic list payload: repetitive keys, the shape gzip handles best. */
function tripList(count) {
  return Array.from({ length: count }, (_, i) => ({
    trip_display_id: `TRP-${String(i).padStart(6, '0')}`,
    route_label: 'Surat → Jaipur',
    trip_date: '2026-08-01',
    total_earnings: 12000,
    fuel_deducted: 2000,
    net_earnings: 10000,
    blockchain_hash: '0x' + 'a'.repeat(64),
    status: 'completed',
  }));
}

/** Minimal app that serves a JSON body through the real middleware. */
function buildApp(payload, contentType = 'application/json') {
  const app = express();
  app.use(compressionMiddleware);
  app.get('/data', (_req, response) => {
    response.set('Content-Type', contentType);
    response.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
  return app;
}

/**
 * Fetch a response as raw bytes.
 *
 * supertest/superagent transparently decompresses gzip, which would make any
 * assertion about transferred size measure the inflated body instead. This
 * uses the http client directly so the bytes on the wire are what is measured.
 *
 * @param {import('express').Express} app
 * @param {Record<string,string>} headers
 * @returns {Promise<{status:number, headers:object, body:Buffer}>}
 */
function rawGet(app, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      http
        .get({ host: '127.0.0.1', port, path: '/data', headers }, (response) => {
          const chunks = [];
          response.on('data', (c) => chunks.push(c));
          response.on('end', () => {
            server.close();
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            });
          });
        })
        .on('error', (err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe('compression configuration', () => {
  it('uses a threshold at or above one MTU', () => {
    expect(COMPRESSION_THRESHOLD_BYTES).toBeGreaterThanOrEqual(1024);
  });

  it('uses a zlib level within the valid range', () => {
    expect(COMPRESSION_LEVEL).toBeGreaterThanOrEqual(1);
    expect(COMPRESSION_LEVEL).toBeLessThanOrEqual(9);
  });
});

describe('shouldCompress', () => {
  it('honours the x-no-compression opt-out', () => {
    expect(shouldCompress(req({ 'x-no-compression': '1' }), res('application/json'))).toBe(false);
  });

  it('skips content that is already compressed', () => {
    for (const type of [
      'image/png',
      'image/jpeg',
      'video/mp4',
      'audio/mpeg',
      'application/zip',
      'application/gzip',
      'application/pdf',
      'application/octet-stream',
    ]) {
      expect(shouldCompress(req(), res(type)), `${type} should be skipped`).toBe(false);
    }
  });

  it('skips Server-Sent Events so individual events are not buffered', () => {
    expect(shouldCompress(req(), res('text/event-stream'))).toBe(false);
  });

  it('is case-insensitive about the content type', () => {
    expect(shouldCompress(req(), res('IMAGE/PNG'))).toBe(false);
    expect(shouldCompress(req(), res('Application/Zip'))).toBe(false);
  });

  it('does not throw when Content-Type is absent', () => {
    expect(() => shouldCompress(req(), { getHeader: () => undefined })).not.toThrow();
  });

  it('allows JSON through to the library default', () => {
    // The library default then checks Accept-Encoding; with gzip advertised
    // a JSON response is compressible.
    expect(
      shouldCompress(req({ 'accept-encoding': 'gzip' }), res('application/json'))
    ).toBe(true);
  });
});

describe('compression middleware end to end', () => {
  it('compresses a large JSON response when the client advertises gzip', async () => {
    const response = await request(buildApp(tripList(200)))
      .get('/data')
      .set('Accept-Encoding', 'gzip');

    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('sets Vary: Accept-Encoding so caches do not serve gzip to plain clients', async () => {
    const response = await request(buildApp(tripList(200)))
      .get('/data')
      .set('Accept-Encoding', 'gzip');

    expect(String(response.headers.vary)).toMatch(/Accept-Encoding/i);
  });

  it('leaves the decompressed body byte-identical to the uncompressed response', async () => {
    const payload = tripList(200);
    const app = buildApp(payload);

    const plain = await rawGet(app, { 'Accept-Encoding': 'identity' });
    const gzipped = await rawGet(app, { 'Accept-Encoding': 'gzip' });

    expect(gzipped.headers['content-encoding']).toBe('gzip');
    const inflated = zlib.gunzipSync(gzipped.body).toString('utf8');

    expect(inflated).toBe(plain.body.toString('utf8'));
    expect(JSON.parse(inflated)).toEqual(payload);
  });

  it('materially reduces the transferred size of a list payload', async () => {
    const payload = tripList(200);
    const raw = Buffer.byteLength(JSON.stringify(payload));

    const gzipped = await rawGet(buildApp(payload), { 'Accept-Encoding': 'gzip' });

    expect(gzipped.headers['content-encoding']).toBe('gzip');
    // Repetitive JSON of this shape compresses far better than 50%; a
    // conservative bound keeps the test stable across zlib versions.
    expect(gzipped.body.length).toBeLessThan(raw * 0.5);
  });

  it('does not compress a response below the threshold', async () => {
    const response = await request(buildApp({ ok: true }))
      .get('/data')
      .set('Accept-Encoding', 'gzip');

    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('does not compress when the client does not advertise gzip', async () => {
    const response = await request(buildApp(tripList(200)))
      .get('/data')
      .set('Accept-Encoding', 'identity');

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(response.text)).toHaveLength(200);
  });

  it('honours x-no-compression end to end', async () => {
    const response = await request(buildApp(tripList(200)))
      .get('/data')
      .set('Accept-Encoding', 'gzip')
      .set('x-no-compression', '1');

    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('does not compress an already-compressed content type', async () => {
    const response = await request(buildApp('x'.repeat(50_000), 'image/png'))
      .get('/data')
      .set('Accept-Encoding', 'gzip');

    expect(response.headers['content-encoding']).toBeUndefined();
  });
});
