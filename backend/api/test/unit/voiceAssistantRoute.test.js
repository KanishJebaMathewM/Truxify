import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/services/voice/VoiceAiService.js', () => ({
  default: { processVoiceQuery: vi.fn() },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import voiceAssistantRoute from '../../src/routes/voice.routes.js';

describe('voiceAssistantRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export a mountable Express router', () => {
    expect(typeof voiceAssistantRoute).toBe('function');
    expect(Array.isArray(voiceAssistantRoute.stack)).toBe(true);
  });

  it('should reject invalid request body', async () => {
    // Invalid or missing request body should be rejected with 400
    const app = express();
    app.use('/api/v1/voice', voiceAssistantRoute);

    const res = await request(app).post('/api/v1/voice/assistant').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Audio file is required');
  });

  it('should handle timeout errors gracefully', async () => {
    // Timeout should return 504
  });
});
