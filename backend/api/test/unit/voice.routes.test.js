import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockProcessVoiceQuery = vi.fn();
vi.mock('../../src/services/voice/VoiceAiService.js', () => ({
  default: { processVoiceQuery: mockProcessVoiceQuery },
}));

// Shared mutable state for req.file simulation
const { mockFile } = vi.hoisted(() => ({ mockFile: undefined }));

vi.mock('multer', () => {
  const single = () => (req, _res, next) => {
    req.file = mockFile;
    next();
  };
  const multerFn = () => ({ single });
  multerFn.memoryStorage = () => ({});
  multerFn.MemoryStorage = class {};
  return { default: multerFn };
});

import voiceRoutes from '../../src/routes/voice.routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/voice', voiceRoutes);
  return app;
}

describe('voice.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFile = undefined;
  });

  describe('POST /assistant', () => {
    it('returns 400 when no audio file is provided', async () => {
      mockFile = undefined;
      const app = makeApp();
      const response = await request(app)
        .post('/voice/assistant')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Audio file is required');
    });

    it('returns 400 for unsupported language code', async () => {
      mockFile = { path: '/tmp/test.m4a', mimetype: 'audio/mp4' };
      mockProcessVoiceQuery.mockResolvedValue({
        pipe: vi.fn(),
        on: vi.fn(),
      });
      const app = makeApp();
      const response = await request(app)
        .post('/voice/assistant')
        .field('language', 'unsupported-lang');
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Unsupported language');
    });

    it('returns 500 when voiceAiService throws', async () => {
      mockFile = { path: '/tmp/test.m4a', mimetype: 'audio/mp4' };
      mockProcessVoiceQuery.mockRejectedValue(new Error('AI service unavailable'));
      const app = makeApp();
      const response = await request(app)
        .post('/voice/assistant')
        .field('language', 'en');
      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Failed to process voice query');
    });

    it('calls voiceAiService with correct path and language en', async () => {
      mockFile = { path: '/tmp/test.m4a', mimetype: 'audio/mp4' };
      const mockStream = { pipe: vi.fn(), on: vi.fn() };
      mockProcessVoiceQuery.mockResolvedValue(mockStream);
      const app = makeApp();
      await request(app)
        .post('/voice/assistant')
        .field('language', 'en');
      expect(mockProcessVoiceQuery).toHaveBeenCalledWith('/tmp/test.m4a', 'en');
    });

    it('calls voiceAiService with supported language hi', async () => {
      mockFile = { path: '/tmp/test.m4a', mimetype: 'audio/mp4' };
      const mockStream = { pipe: vi.fn(), on: vi.fn() };
      mockProcessVoiceQuery.mockResolvedValue(mockStream);
      const app = makeApp();
      await request(app)
        .post('/voice/assistant')
        .field('language', 'hi');
      expect(mockProcessVoiceQuery).toHaveBeenCalledWith('/tmp/test.m4a', 'hi');
    });
  });
});
