import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  globalLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  createUserClient: vi.fn(() => null),
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: 'not found' })),
        })),
      })),
    })),
  },
}));

vi.mock('../../src/controllers/shipmentController.js', () => ({
  getShipmentDetails: async (req, res) => {
    const shipmentId = req.query.shipmentId || req.params.shipmentId;
    if (!shipmentId) {
      return res.status(400).json({ error: 'shipmentId is required' });
    }
    if (shipmentId === 'missing') {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    return res.json({
      success: true,
      data: { id: shipmentId, customer_id: 'user-123', driver_id: null },
    });
  },
}));

describe('shipmentRoutes', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const shipmentRoutes = (await import('../../src/routes/shipmentRoutes.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/shipment', shipmentRoutes);
  });

  it('GET /details responds with 200 and shipment data when shipmentId is provided', async () => {
    const res = await request(app)
      .get('/api/shipment/details')
      .query({ shipmentId: 'ship-123' })
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id', 'ship-123');
  });

  it('GET /details responds with 400 when shipmentId is missing', async () => {
    const res = await request(app)
      .get('/api/shipment/details')
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('shipmentId is required');
  });

  it('GET /details responds with 404 when shipment is not found', async () => {
    const res = await request(app)
      .get('/api/shipment/details')
      .query({ shipmentId: 'missing' })
      .set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Shipment not found');
  });
});
