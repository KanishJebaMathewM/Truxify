import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const { voiceMock } = vi.hoisted(() => ({
  voiceMock: { processVoiceQuery: vi.fn() },
}));

vi.mock('../../src/services/voice/VoiceAiService.js', () => ({ default: voiceMock }));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import voiceRoutes from '../../src/routes/voice.routes.js';

function makeApp() {
  const app = express();
  app.use('/voice', voiceRoutes);
  return app;
}

describe('voice.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /voice/assistant', () => {
    it('returns 400 when no audio file is uploaded', async () => {
      const res = await request(makeApp()).post('/voice/assistant').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Audio file is required');
    });

    it('returns 500 when the voice service errors', async () => {
      voiceMock.processVoiceQuery.mockRejectedValue(new Error('svc down'));
      const res = await request(makeApp())
        .post('/voice/assistant')
        .attach('audio', Buffer.from('fake-audio-data'), { filename: 'a.wav', contentType: 'audio/wav' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to process voice query');
    });
  });
});
