import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import responseSanitizer from '../../src/middleware/responseSanitizer.js';

async function send(payload) {
  const app = express();
  app.use(responseSanitizer);
  app.get('/', (_req, res) => res.json(payload));
  return request(app).get('/');
}

describe('response sanitizer Date serialization', () => {
  it('preserves tracking history timestamps alongside private-field removal', async () => {
    const timestamp = new Date('2026-10-06T03:04:05.678Z');
    const payload = { points: [{ latitude: 12.9, timestamp, _debug: 'secret' }], _internal: true };
    const response = await send(payload);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ points: [{ latitude: 12.9, timestamp: timestamp.toISOString() }] });
    expect(payload.points[0].timestamp).toBe(timestamp);
    expect(payload.points[0]._debug).toBe('secret');
  });

  it('preserves top-level Date serialization', async () => {
    const timestamp = new Date('2026-01-01T00:00:00Z');
    expect((await send(timestamp)).body).toBe(timestamp.toISOString());
  });

  it('preserves Date values in arrays', async () => {
    const timestamp = new Date(0);
    expect((await send([timestamp, { timestamp, _private: true }])).body)
      .toEqual([timestamp.toISOString(), { timestamp: timestamp.toISOString() }]);
  });

  it('serializes invalid dates as null, following JSON behavior', async () => {
    expect((await send({ timestamp: new Date('invalid') })).body).toEqual({ timestamp: null });
  });
});
