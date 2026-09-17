import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  requireApiKey,
  authConfig,
  keyRepo,
} from '../../src/middleware/apiKey.js';

describe('requireApiKey middleware', () => {
  const originalValidKeys = process.env.VALID_API_KEYS;
  let app;

  beforeEach(() => {
    process.env.VALID_API_KEYS = 'test_key_123';

    keyRepo.keyStore.clear();
    authConfig.reload();

    app = express();

    app.get('/protected', requireApiKey, (req, res) => {
      res.status(200).json({ success: true });
    });
  });

  afterEach(() => {
    keyRepo.keyStore.clear();
    process.env.VALID_API_KEYS = originalValidKeys;
    authConfig.reload();
  });

  it('rejects API keys supplied through the query string', async () => {
    const res = await request(app)
      .get('/protected?api_key=test_key_123');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing API Key');
  });

  it('accepts a valid API key from the x-api-key header', async () => {
    const res = await request(app)
      .get('/protected')
      .set('x-api-key', 'test_key_123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});