/**
 * Regression tests for POST /query text-only requests.
 *
 * Run with: npx vitest run test/unit/voiceRoutesTextOnly.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockProcessVoiceQuery } = vi.hoisted(() => ({
  mockProcessVoiceQuery: vi.fn(),
}));

vi.mock('../../src/services/voiceService.js', () => ({
  processVoiceQuery: mockProcessVoiceQuery,
  audioCache: new Map(),
}));

vi.mock('../../src/lib/audioValidation.js', () => ({
  ALLOWED_AUDIO_MIME_TYPES: ['audio/wav'],
  AudioValidationError: class AudioValidationError extends Error {},
  validateAudioBuffer: vi.fn(),
}));

vi.mock('../../src/lib/uploadFilename.js', () => ({
  sanitizeUploadFilename: vi.fn((filename, fallback) => filename || fallback),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'customer' };
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

import voiceRouter from '../../src/routes/voiceRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(voiceRouter);
  return app;
}

describe('voice query route text-only requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessVoiceQuery.mockResolvedValue({
      transcript: 'Where is my package?',
      response_text: 'Your shipment is in transit.',
      audio_url: '/api/voice/audio/audio-1',
      intent: 'package_status',
    });
  });

  it('passes text-only JSON queries without dereferencing req.file', async () => {
    const res = await request(makeApp())
      .post('/query')
      .send({ query: 'Where is my package?', bookingId: 'booking-1' });

    expect(res.status).toBe(200);
    expect(mockProcessVoiceQuery).toHaveBeenCalledWith(
      'user-1',
      'booking-1',
      null,
      'voice-query.wav',
      'Where is my package?'
    );
    expect(res.body.audio_url).toBe('https://truxify.app/api/voice/audio/audio-1');
  });

  it('passes text-only multipart form requests without dereferencing req.file', async () => {
    const res = await request(makeApp())
      .post('/query')
      .field('text', 'When will my shipment arrive?')
      .field('bookingId', 'booking-2');

    expect(res.status).toBe(200);
    expect(mockProcessVoiceQuery).toHaveBeenCalledWith(
      'user-1',
      'booking-2',
      null,
      'voice-query.wav',
      'When will my shipment arrive?'
    );
  });

  it('still rejects requests with neither audio nor text', async () => {
    const res = await request(makeApp())
      .post('/query')
      .send({ bookingId: 'booking-3' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A valid audio file or text query is required.');
    expect(mockProcessVoiceQuery).not.toHaveBeenCalled();
  });
});
