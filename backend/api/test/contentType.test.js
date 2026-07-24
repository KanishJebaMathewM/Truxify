import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';

import { requireJsonContent } from '../../src/middleware/contentType.js';

function createApp() {
  const app = express();

  app.use(requireJsonContent);

  app.post('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  app.put('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  app.patch('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  app.get('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  app.delete('/test', (req, res) => {
    res.status(200).json({ success: true });
  });

  return app;
}

describe('requireJsonContent middleware', () => {
  const app = createApp();

  it('allows application/json', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
  });

  it('allows application/x-www-form-urlencoded', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/x-www-form-urlencoded');

    expect(res.status).toBe(200);
  });

  it('allows multipart/form-data', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'multipart/form-data; boundary=test');

    expect(res.status).toBe(200);
  });

  it('rejects unsupported content types', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'text/plain');

    expect(res.status).toBe(415);
  });

  it('rejects missing Content-Type on POST', async () => {
    const res = await request(app)
      .post('/test');

    expect(res.status).toBe(415);
  });

  it('allows GET without Content-Type', async () => {
    const res = await request(app)
      .get('/test');

    expect(res.status).toBe(200);
  });

  it('allows DELETE without Content-Type', async () => {
    const res = await request(app)
      .delete('/test');

    expect(res.status).toBe(200);
  });

  it('rejects invalid Content-Type on PATCH', async () => {
    const res = await request(app)
      .patch('/test')
      .set('Content-Type', 'text/plain');

    expect(res.status).toBe(415);
  });

  it('rejects invalid Content-Type on PUT', async () => {
    const res = await request(app)
      .put('/test')
      .set('Content-Type', 'text/plain');

    expect(res.status).toBe(415);
  });
});