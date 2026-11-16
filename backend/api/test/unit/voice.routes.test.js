/**
 * Comprehensive Unit Tests for backend/api/src/routes/voice.routes.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import { unlink } from 'fs/promises';
import request from 'supertest';
import express from 'express';

// Mock authentication middleware to pass a valid test user
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'driver-123', role: 'driver' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

// Mock voiceAiService
const mockProcessVoiceQuery = vi.fn();
vi.mock('../../src/services/voice/VoiceAiService.js', () => ({
  default: {
    processVoiceQuery: (...args) => mockProcessVoiceQuery(...args),
  },
}));

// Mock logger to keep test output clean
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import voiceRouter from '../../src/routes/voice.routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/voice', voiceRouter);
  return app;
}

describe('POST /voice/assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The real service deletes the upload once processed; the mock does not, so
  // remove the files multer wrote to uploads/voice/ during successful requests.
  afterEach(async () => {
    await Promise.all(
      mockProcessVoiceQuery.mock.calls.map(([filePath]) => unlink(filePath).catch(() => {}))
    );
  });

  it('returns 400 when no audio file is attached in the request', async () => {
    const res = await request(makeApp())
      .post('/voice/assistant')
      .field('language', 'en');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockProcessVoiceQuery).not.toHaveBeenCalled();
  });

  it('successfully processes valid audio file, defaults language to "en", and streams audio/mpeg response', async () => {
    mockProcessVoiceQuery.mockResolvedValue(
      Readable.from([Buffer.from('chunk1'), Buffer.from('chunk2')])
    );

    const res = await request(makeApp())
      .post('/voice/assistant')
      .attach('audio', Buffer.from('fake-audio-bytes'), {
        filename: 'query.wav',
        contentType: 'audio/wav',
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(mockProcessVoiceQuery).toHaveBeenCalledTimes(1);
    
    const [filePath, language] = mockProcessVoiceQuery.mock.calls[0];
    expect(filePath).toBeDefined();
    expect(language).toBe('en');
  });

  it('respects explicitly provided language parameter', async () => {
    mockProcessVoiceQuery.mockResolvedValue(Readable.from([Buffer.from('audio-data')]));

    const res = await request(makeApp())
      .post('/voice/assistant')
      .field('language', 'hi')
      .attach('audio', Buffer.from('fake-audio-bytes'), {
        filename: 'query.wav',
        contentType: 'audio/wav',
      });

    expect(res.status).toBe(200);
    const [, language] = mockProcessVoiceQuery.mock.calls[0];
    expect(language).toBe('hi');
  });

  it('returns 500 status response and handles errors when voiceAiService throws an exception', async () => {
    mockProcessVoiceQuery.mockRejectedValue(new Error('AI Service failure'));

    const res = await request(makeApp())
      .post('/voice/assistant')
      .field('language', 'en')
      .attach('audio', Buffer.from('fake-audio-bytes'), {
        filename: 'query.wav',
        contentType: 'audio/wav',
      });

    expect(res.status).toBe(500);
  });
});