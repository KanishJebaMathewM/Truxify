import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

const { signalingMock } = vi.hoisted(() => ({
  signalingMock: {
    getStats: vi.fn(() => ({ peers: 0 })),
    getPeersNearLocation: vi.fn(),
    canUserAccessPeer: vi.fn(),
    getOfflineGPSData: vi.fn(),
    syncOfflineData: vi.fn(),
  },
}));

vi.mock('../../src/sockets/webrtc.js', () => ({
  getWebRTCSignaling: vi.fn(() => signalingMock),
}));

import webrtcRoutes from '../../src/routes/webrtcRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', webrtcRoutes);
  return app;
}

describe('webrtcRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signalingMock.getPeersNearLocation.mockResolvedValue([]);
    signalingMock.canUserAccessPeer.mockReturnValue(true);
    signalingMock.getOfflineGPSData.mockResolvedValue({ points: [] });
    signalingMock.syncOfflineData.mockResolvedValue();
  });

  describe('GET /webrtc/stats', () => {
    it('returns stats on success', async () => {
      const res = await request(makeApp()).get('/webrtc/stats');
      expect(res.status).toBe(200);
      expect(res.body.data.peers).toBe(0);
    });
  });

  describe('GET /webrtc/nearby', () => {
    it('returns 400 when lat/lng are missing', async () => {
      const res = await request(makeApp()).get('/webrtc/nearby');
      expect(res.status).toBe(400);
    });

    it('returns 400 for out-of-range coordinates', async () => {
      const res = await request(makeApp()).get('/webrtc/nearby').query({ lat: '999', lng: '10', radius: '5' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid radius', async () => {
      const res = await request(makeApp()).get('/webrtc/nearby').query({ lat: '12.3', lng: '77.6', radius: '-1' });
      expect(res.status).toBe(400);
    });

    it('returns peers on success', async () => {
      signalingMock.getPeersNearLocation.mockResolvedValue([{ id: 'p1' }]);
      const res = await request(makeApp()).get('/webrtc/nearby').query({ lat: '12.3', lng: '77.6', radius: '5' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 'p1' }]);
      expect(res.body.count).toBe(1);
    });
  });

  describe('GET /webrtc/offline/:peerId', () => {
    it('returns 403 when access is denied', async () => {
      signalingMock.canUserAccessPeer.mockReturnValue(false);
      const res = await request(makeApp()).get('/webrtc/offline/p1');
      expect(res.status).toBe(403);
    });

    it('returns offline data when allowed', async () => {
      const res = await request(makeApp()).get('/webrtc/offline/p1');
      expect(res.status).toBe(200);
      expect(res.body.data.points).toEqual([]);
    });
  });

  describe('POST /webrtc/sync/:peerId', () => {
    it('returns success after syncing', async () => {
      const res = await request(makeApp()).post('/webrtc/sync/p1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
