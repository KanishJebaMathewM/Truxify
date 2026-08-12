import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  globalLimiter: (_req, _res, next) => next(),
}));

const { ctrlMock } = vi.hoisted(() => ({
  ctrlMock: { getShipmentDetails: vi.fn() },
}));

vi.mock('../../src/controllers/shipmentController.js', () => ctrlMock);

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import shipmentRoutes from '../../src/routes/shipmentRoutes.js';

function makeApp() {
  const app = express();
  app.use('/shipment', shipmentRoutes);
  return app;
}

describe('shipmentRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /shipment/details', () => {
    it('delegates to the controller and returns its response', async () => {
      ctrlMock.getShipmentDetails.mockImplementation((req, res) => {
        res.status(200).json({ shipment: { id: 's1' } });
      });
      const res = await request(makeApp()).get('/shipment/details');
      expect(res.status).toBe(200);
      expect(res.body.shipment.id).toBe('s1');
    });

    it('propagates controller error responses', async () => {
      ctrlMock.getShipmentDetails.mockImplementation((req, res) => {
        res.status(404).json({ error: 'Shipment not found' });
      });
      const res = await request(makeApp()).get('/shipment/details');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Shipment not found');
    });
  });
});
