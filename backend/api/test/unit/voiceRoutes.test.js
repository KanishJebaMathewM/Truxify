import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

vi.mock('../../../../src/services/voice/VoiceAiService.js', () => ({
  default: {
    processVoiceQuery: vi.fn().mockResolvedValue(Buffer.from('audio')),
  },
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
}));

vi.mock('../../../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

import voiceRouter from '../../../../src/routes/voice.routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(voiceRouter);
  return app;
}

describe('voice routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
  });

  it('POST /assistant returns 400 when no audio file', async () => {
    const res = await request(app)
      .post('/assistant')
      .set('Authorization', 'Bearer token');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Audio file is required');
  });
});
