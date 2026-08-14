import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1', role: 'driver' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const { voiceMock, audioMock } = vi.hoisted(() => ({
  voiceMock: { processVoiceQuery: vi.fn() },
  audioMock: { get: vi.fn() },
}));

vi.mock('../../src/services/voiceService.js', () => ({ processVoiceQuery: voiceMock.processVoiceQuery, audioCache: audioMock }));
vi.mock('../../src/lib/audioValidation.js', () => ({
  ALLOWED_AUDIO_MIME_TYPES: ['audio/wav', 'audio/mpeg'],
  AudioValidationError: class extends Error {},
  validateAudioBuffer: vi.fn().mockReturnValue('audio/wav'),
}));
vi.mock('../../src/lib/uploadFilename.js', () => ({
  sanitizeUploadFilename: vi.fn((n, f) => n || f),
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import voiceRoutes from '../../src/routes/voiceRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/voice', voiceRoutes);
  return app;
}

describe('voiceRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceMock.processVoiceQuery.mockResolvedValue({ text: 'hello', audio_url: '/audio/1' });
  });

  describe('POST /voice/query', () => {
    it('returns 400 when no file is uploaded', async () => {
      const res = await request(makeApp()).post('/voice/query').send({ bookingId: 'b1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('A valid audio file is required.');
    });

    it('returns 400 when bookingId is missing', async () => {
      const res = await request(makeApp())
        .post('/voice/query')
        .attach('file', Buffer.from('RIFF....WAVE'), { filename: 'a.wav', contentType: 'audio/wav' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Booking ID is required.');
    });

    it('returns the result on success', async () => {
      const res = await request(makeApp())
        .post('/voice/query')
        .field('bookingId', 'b1')
        .attach('file', Buffer.from('RIFF....WAVE'), { filename: 'a.wav', contentType: 'audio/wav' });
      expect(res.status).toBe(200);
      expect(res.body.text).toBe('hello');
    });
  });

  describe('GET /voice/audio/:id', () => {
    it('returns 404 when the audio is not cached', async () => {
      audioMock.get.mockReturnValue(null);
      const res = await request(makeApp()).get('/voice/audio/1');
      expect(res.status).toBe(404);
    });

    it('returns 403 for another users audio', async () => {
      audioMock.get.mockReturnValue({ userId: 'other', buffer: Buffer.from('x') });
      const res = await request(makeApp()).get('/voice/audio/1');
      expect(res.status).toBe(403);
    });

    it('returns the audio for the owner', async () => {
      audioMock.get.mockReturnValue({ userId: 'u1', buffer: Buffer.from('x') });
      const res = await request(makeApp()).get('/voice/audio/1');
      expect(res.status).toBe(200);
    });
  });
});
