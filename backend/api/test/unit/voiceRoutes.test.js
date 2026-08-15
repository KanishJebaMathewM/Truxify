/**
 * Unit tests for backend/api/src/routes/voice.routes.js
 *
 * Coverage:
 *   - POST /assistant returns 400 when no audio file
 *   - POST /assistant returns 500 when voiceAiService throws
 *   - POST /assistant with valid audio file streams response
 *
 * Run with: npm run test:unit -- test/unit/voiceRoutes.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

const { mockProcessVoiceQuery } = vi.hoisted(() => ({
  mockProcessVoiceQuery: vi.fn(),
}));

vi.mock('../../src/services/voice/VoiceAiService.js', () => ({
  default: {
    processVoiceQuery: mockProcessVoiceQuery,
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

import voiceRouter from '../../src/routes/voice.routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(voiceRouter);
  return app;
}

function mockAudioFile() {
  const buf = Buffer.from('fake audio data');
  const readable = new Readable();
  readable.push(buf);
  readable.push(null);
  return readable;
}

describe('voice routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();
  });

  it('POST /assistant returns 400 when no audio file', async () => {
    const res = await request(app)
      .post('/assistant')
      .set('Authorization', 'Bearer token');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Audio file is required');
  });

  it('POST /assistant returns 500 when voiceAiService throws', async () => {
    mockProcessVoiceQuery.mockRejectedValueOnce(new Error('Service unavailable'));
    const res = await request(app)
      .post('/assistant')
      .set('Authorization', 'Bearer token')
      .attach('audio', Buffer.from('fake'), { filename: 'test.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to process voice query');
  });

  it('POST /assistant with valid audio file sets up chunked streaming', async () => {
    const mockStream = mockAudioFile();
    mockProcessVoiceQuery.mockResolvedValueOnce(mockStream);
    const res = await request(app)
      .post('/assistant')
      .set('Authorization', 'Bearer token')
      .attach('audio', Buffer.from('fake'), { filename: 'test.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(mockProcessVoiceQuery).toHaveBeenCalled();
  });
});
