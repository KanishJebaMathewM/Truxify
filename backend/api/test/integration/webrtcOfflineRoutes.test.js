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

describe('WebRTC offline routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks offline GPS reads for peers the user cannot access', async () => {
    signalingMock.canUserAccessPeer.mockReturnValue(false);

    const res = await request(buildApp()).get('/api/webrtc/offline/peer-2');

    expect(res.status).toBe(403);
    expect(signalingMock.getOfflineGPSData).not.toHaveBeenCalled();
  });

  it('returns offline GPS data for an accessible peer', async () => {
    signalingMock.canUserAccessPeer.mockReturnValue(true);
    signalingMock.getOfflineGPSData.mockResolvedValue([{ peerId: 'peer-1' }]);

    const res = await request(buildApp()).get('/api/webrtc/offline/peer-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ peerId: 'peer-1' }]);
    expect(signalingMock.getOfflineGPSData).toHaveBeenCalledWith('peer-1', undefined);
  });
});
