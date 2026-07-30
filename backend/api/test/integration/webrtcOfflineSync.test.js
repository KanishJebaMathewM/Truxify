import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const signalingMock = {
  canUserAccessPeer: vi.fn(),
  getOfflineGPSData: vi.fn(),
  syncOfflineData: vi.fn(),
};

vi.mock('../../src/sockets/webrtc.js', () => ({
  getWebRTCSignaling: () => signalingMock,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'user-1', role: 'driver' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
}));

const { default: webrtcRoutes } = await import('../../src/routes/webrtcRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', webrtcRoutes);
  return app;
}

describe('WebRTC offline sync route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks offline sync for peers the user cannot access', async () => {
    signalingMock.canUserAccessPeer.mockReturnValue(false);

    const res = await request(buildApp()).post('/api/webrtc/sync/peer-2');

    expect(res.status).toBe(403);
    expect(signalingMock.syncOfflineData).not.toHaveBeenCalled();
  });

  it('syncs offline data for an accessible peer', async () => {
    signalingMock.canUserAccessPeer.mockReturnValue(true);
    signalingMock.syncOfflineData.mockResolvedValue();

    const res = await request(buildApp()).post('/api/webrtc/sync/peer-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(signalingMock.syncOfflineData).toHaveBeenCalledWith('peer-1');
  });
});
