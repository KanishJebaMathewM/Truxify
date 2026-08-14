import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  deviceLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

// Pull in real Zod-backed validate middleware so schema validation runs
const { validateBody: realValidateBody, validateParams: realValidateParams } = vi.hoisted(
  () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('../../src/middleware/validate.js');
    return { validateBody: m.validateBody, validateParams: m.validateParams };
  }
);

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: (schema) => realValidateBody(schema),
  validateParams: (schema) => realValidateParams(schema),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  findHandoffCandidates,
  createTransferRequest,
  listTransfers,
  getTransfer,
  acceptTransferRequest,
  declineTransferRequest,
  cancelTransferRequest,
  verifyHandoff,
} = vi.hoisted(() => ({
  findHandoffCandidates: vi.fn(),
  createTransferRequest: vi.fn(),
  listTransfers: vi.fn(),
  getTransfer: vi.fn(),
  acceptTransferRequest: vi.fn(),
  declineTransferRequest: vi.fn(),
  cancelTransferRequest: vi.fn(),
  verifyHandoff: vi.fn(),
}));

vi.mock('../../src/services/order/crossDockService.js', () => ({
  findHandoffCandidates,
  createTransferRequest,
  listTransfers,
  getTransfer,
  acceptTransferRequest,
  declineTransferRequest,
  cancelTransferRequest,
  verifyHandoff,
}));

import crossDockRoutes from '../../src/routes/crossDockRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/cross-dock', crossDockRoutes);
  return app;
}

describe('crossDockRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const VALID_ORDER_ID = '123e4567-e89b-12d3-a456-426614174000';
  const VALID_DRIVER_ID = '223e4567-e89b-12d3-a456-426614174001';
  const VALID_TRANSFER_ID = '323e4567-e89b-12d3-a456-426614174002';

  describe('GET /cross-dock/candidates', () => {
    it('cd1: returns 200 with candidates on valid query', async () => {
      const mockCandidates = [
        { driver_id: VALID_DRIVER_ID, name: 'Driver 1', distance_km: 5.2 },
        { driver_id: '323e4567-e89b-12d3-a456-426614174003', name: 'Driver 2', distance_km: 8.1 },
      ];
      findHandoffCandidates.mockResolvedValue(mockCandidates);

      const res = await request(makeApp())
        .get('/cross-dock/candidates')
        .query({
          orderId: VALID_ORDER_ID,
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
          radius_km: '10',
        });

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(2);
      expect(findHandoffCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: VALID_ORDER_ID,
          crossDockLat: 19.076,
          crossDockLng: 72.8777,
          fromDriverId: 'u1',
          radiusKm: 10,
        })
      );
    });

    it('cd2: returns 400 when orderId is missing', async () => {
      const res = await request(makeApp())
        .get('/cross-dock/candidates')
        .query({
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('orderId');
    });

    it('cd3: returns 400 when orderId is invalid UUID', async () => {
      const res = await request(makeApp())
        .get('/cross-dock/candidates')
        .query({
          orderId: 'not-a-valid-uuid',
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('orderId');
    });

    it('cd4: returns 400 when latitude is out of range', async () => {
      const res = await request(makeApp())
        .get('/cross-dock/candidates')
        .query({
          orderId: VALID_ORDER_ID,
          cross_dock_lat: '100',
          cross_dock_lng: '72.8777',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid candidate');
    });

    it('cd5: returns 500 when service throws error', async () => {
      findHandoffCandidates.mockRejectedValue(new Error('Database error'));

      const res = await request(makeApp())
        .get('/cross-dock/candidates')
        .query({
          orderId: VALID_ORDER_ID,
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });

  describe('POST /cross-dock', () => {
    it('cd6: returns 201 with transfer on successful creation', async () => {
      const mockTransfer = {
        id: VALID_TRANSFER_ID,
        order_id: VALID_ORDER_ID,
        from_driver_id: 'u1',
        to_driver_id: VALID_DRIVER_ID,
        status: 'pending',
        handoff_code: '123456',
      };
      createTransferRequest.mockResolvedValue(mockTransfer);

      const res = await request(makeApp())
        .post('/cross-dock')
        .query({ orderId: VALID_ORDER_ID })
        .send({
          to_driver_id: VALID_DRIVER_ID,
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
          cross_dock_note: 'Meet at gate B',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(VALID_TRANSFER_ID);
      expect(res.body.status).toBe('pending');
    });

    it('cd7: returns 400 when orderId query param is missing', async () => {
      const res = await request(makeApp())
        .post('/cross-dock')
        .send({
          to_driver_id: VALID_DRIVER_ID,
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('orderId');
    });

    it('cd8: returns 400 when to_driver_id is invalid', async () => {
      const res = await request(makeApp())
        .post('/cross-dock')
        .query({ orderId: VALID_ORDER_ID })
        .send({
          to_driver_id: 'invalid-uuid',
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
        });

      expect(res.status).toBe(400);
    });

    it('cd9: returns 500 when service throws error', async () => {
      createTransferRequest.mockRejectedValue(new Error('Service unavailable'));

      const res = await request(makeApp())
        .post('/cross-dock')
        .query({ orderId: VALID_ORDER_ID })
        .send({
          to_driver_id: VALID_DRIVER_ID,
          cross_dock_lat: '19.0760',
          cross_dock_lng: '72.8777',
        });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /cross-dock', () => {
    it('cd10: returns 200 with transfers list', async () => {
      const mockTransfers = [
        { id: VALID_TRANSFER_ID, status: 'pending', from_driver_id: 'u1' },
        { id: '423e4567-e89b-12d3-a456-426614174004', status: 'accepted', from_driver_id: 'u1' },
      ];
      listTransfers.mockResolvedValue(mockTransfers);

      const res = await request(makeApp())
        .get('/cross-dock')
        .query({ status: 'pending', limit: '20' });

      expect(res.status).toBe(200);
      expect(res.body.transfers).toHaveLength(2);
      expect(listTransfers).toHaveBeenCalledWith({
        driverId: 'u1',
        status: 'pending',
        limit: 20,
      });
    });

    it('cd11: returns 200 with empty array when no transfers', async () => {
      listTransfers.mockResolvedValue([]);

      const res = await request(makeApp()).get('/cross-dock');

      expect(res.status).toBe(200);
      expect(res.body.transfers).toHaveLength(0);
    });

    it('cd12: uses default limit when not provided', async () => {
      listTransfers.mockResolvedValue([]);

      await request(makeApp()).get('/cross-dock');

      expect(listTransfers).toHaveBeenCalledWith({
        driverId: 'u1',
        status: undefined,
        limit: 50,
      });
    });

    it('cd13: returns 500 when service throws error', async () => {
      listTransfers.mockRejectedValue(new Error('Database error'));

      const res = await request(makeApp()).get('/cross-dock');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /cross-dock/:id', () => {
    it('cd14: returns 200 with transfer details (without OTP hash)', async () => {
      const mockTransfer = {
        id: VALID_TRANSFER_ID,
        order_id: VALID_ORDER_ID,
        from_driver_id: 'u1',
        to_driver_id: VALID_DRIVER_ID,
        status: 'accepted',
        otp_hash: 'secret-hash',
        otp_attempts: 0,
        otp_expires_at: '2024-01-01T00:00:00Z',
      };
      getTransfer.mockResolvedValue(mockTransfer);

      const res = await request(makeApp()).get(`/cross-dock/${VALID_TRANSFER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.transfer.id).toBe(VALID_TRANSFER_ID);
      expect(res.body.transfer.otp_hash).toBeUndefined();
      expect(res.body.transfer.otp_attempts).toBeUndefined();
      expect(res.body.transfer.otp_expires_at).toBeUndefined();
    });

    it('cd15: returns 400 for invalid UUID format', async () => {
      const res = await request(makeApp()).get('/cross-dock/invalid-id');

      expect(res.status).toBe(400);
    });

    it('cd16: returns 500 when service throws error', async () => {
      getTransfer.mockRejectedValue(new Error('Database error'));

      const res = await request(makeApp()).get(`/cross-dock/${VALID_TRANSFER_ID}`);

      expect(res.status).toBe(500);
    });
  });

  describe('POST /cross-dock/:id/accept', () => {
    it('cd17: returns 200 with updated transfer on accept', async () => {
      const mockTransfer = {
        id: VALID_TRANSFER_ID,
        status: 'accepted',
        accepted_at: '2024-01-01T12:00:00Z',
      };
      acceptTransferRequest.mockResolvedValue(mockTransfer);

      const res = await request(makeApp()).post(`/cross-dock/${VALID_TRANSFER_ID}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accepted');
      expect(acceptTransferRequest).toHaveBeenCalledWith({
        transferId: VALID_TRANSFER_ID,
        driverId: 'u1',
      });
    });

    it('cd18: returns 400 for invalid UUID', async () => {
      const res = await request(makeApp()).post('/cross-dock/not-valid-id/accept');

      expect(res.status).toBe(400);
    });

    it('cd19: returns 500 when service throws error', async () => {
      acceptTransferRequest.mockRejectedValue(new Error('Cannot accept'));

      const res = await request(makeApp()).post(`/cross-dock/${VALID_TRANSFER_ID}/accept`);

      expect(res.status).toBe(500);
    });
  });

  describe('POST /cross-dock/:id/decline', () => {
    it('cd20: returns 200 with updated transfer on decline', async () => {
      const mockTransfer = {
        id: VALID_TRANSFER_ID,
        status: 'declined',
        declined_at: '2024-01-01T12:00:00Z',
      };
      declineTransferRequest.mockResolvedValue(mockTransfer);

      const res = await request(makeApp()).post(`/cross-dock/${VALID_TRANSFER_ID}/decline`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('declined');
    });

    it('cd21: returns 400 for invalid UUID', async () => {
      const res = await request(makeApp()).post('/cross-dock/invalid-id/decline');

      expect(res.status).toBe(400);
    });

    it('cd22: returns 500 when service throws error', async () => {
      declineTransferRequest.mockRejectedValue(new Error('Cannot decline'));

      const res = await request(makeApp()).post(`/cross-dock/${VALID_TRANSFER_ID}/decline`);

      expect(res.status).toBe(500);
    });
  });

  describe('POST /cross-dock/:id/cancel', () => {
    it('cd23: returns 200 with updated transfer on cancel', async () => {
      const mockTransfer = {
        id: VALID_TRANSFER_ID,
        status: 'cancelled',
        cancelled_at: '2024-01-01T12:00:00Z',
      };
      cancelTransferRequest.mockResolvedValue(mockTransfer);

      const res = await request(makeApp()).post(`/cross-dock/${VALID_TRANSFER_ID}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('cd24: returns 400 for invalid UUID', async () => {
      const res = await request(makeApp()).post('/cross-dock/invalid-id/cancel');

      expect(res.status).toBe(400);
    });

    it('cd25: returns 500 when service throws error', async () => {
      cancelTransferRequest.mockRejectedValue(new Error('Cannot cancel'));

      const res = await request(makeApp()).post(`/cross-dock/${VALID_TRANSFER_ID}/cancel`);

      expect(res.status).toBe(500);
    });
  });

  describe('POST /cross-dock/:id/verify', () => {
    it('cd26: returns 200 with verified transfer on valid handoff code', async () => {
      const mockTransfer = {
        id: VALID_TRANSFER_ID,
        status: 'verified',
        verified_at: '2024-01-01T12:00:00Z',
      };
      verifyHandoff.mockResolvedValue(mockTransfer);

      const res = await request(makeApp())
        .post(`/cross-dock/${VALID_TRANSFER_ID}/verify`)
        .send({ handoff_code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('verified');
      expect(verifyHandoff).toHaveBeenCalledWith({
        transferId: VALID_TRANSFER_ID,
        driverId: 'u1',
        handoffCode: '123456',
      });
    });

    it('cd27: returns 400 for invalid UUID', async () => {
      const res = await request(makeApp())
        .post('/cross-dock/invalid-id/verify')
        .send({ handoff_code: '123456' });

      expect(res.status).toBe(400);
    });

    it('cd28: returns 400 for invalid handoff code format', async () => {
      const res = await request(makeApp())
        .post(`/cross-dock/${VALID_TRANSFER_ID}/verify`)
        .send({ handoff_code: 'abc' });

      expect(res.status).toBe(400);
    });

    it('cd29: returns 500 when service throws error', async () => {
      verifyHandoff.mockRejectedValue(new Error('Invalid or expired handoff code'));

      const res = await request(makeApp())
        .post(`/cross-dock/${VALID_TRANSFER_ID}/verify`)
        .send({ handoff_code: '123456' });

      expect(res.status).toBe(500);
    });
  });
});
