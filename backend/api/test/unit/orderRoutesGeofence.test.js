import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/routes/orderRoutes.js';

const app = express();
app.use(express.json());
app.use(orderRoutes);

describe('POST /api/deliveries/:id/geofence-confirm validation', () => {
  it('should accept valid lat, lng and geofence_radius_m', async () => {
    const res = await request(app)
      .post('/api/deliveries/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 100 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should reject NaN geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/deliveries/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should reject non-positive geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/deliveries/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: -50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
