import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    const userId = req.get('x-user-id');
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = {
      id: userId,
      role: req.get('x-user-role') || 'customer',
    };
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const { audioCache } = await import('../../src/services/voiceService.js');
const { default: voiceRouter } = await import('../../src/routes/voiceRoutes.js');

function buildApp() {
  const app = express();
  app.use('/api/voice', voiceRouter);
  return app;
}

describe('Voice audio cache access', () => {
  beforeEach(() => {
    audioCache.clear();
  });

  it('streams cached audio for the owner', async () => {
    audioCache.set('audio-1', {
      buffer: Buffer.from('audio bytes'),
      userId: 'user-1',
      timestamp: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/voice/audio/audio-1')
      .set('x-user-id', 'user-1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(Buffer.from(res.body).toString()).toBe('audio bytes');
  });

  it('denies cached audio to another user', async () => {
    audioCache.set('audio-2', {
      buffer: Buffer.from('private audio'),
      userId: 'user-1',
      timestamp: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/voice/audio/audio-2')
      .set('x-user-id', 'user-2');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access Denied: You do not have permission to access this audio.');
  });

  it('denies cached audio entries without an owner binding', async () => {
    audioCache.set('legacy-audio', {
      buffer: Buffer.from('legacy audio'),
      timestamp: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/voice/audio/legacy-audio')
      .set('x-user-id', 'user-1');

    expect(res.status).toBe(403);
  });
});
