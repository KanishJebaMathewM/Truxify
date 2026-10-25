import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'driver' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

const {
  default: iftaTaxRouter,
} = await import('../../src/routes/iftaTax.js');

const {
  generateIftaReport,
  MAX_IFTA_FUEL_PURCHASES,
  MAX_IFTA_WAYPOINTS,
} = await import('../../src/services/iftaTax.js');

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/ifta-tax', iftaTaxRouter);
  return app;
}

function waypoint(index) {
  return {
    latitude: 30 + index * 0.0001,
    longitude: -97,
    jurisdictionState: 'TX',
  };
}

describe('IFTA batch bounds', () => {
  it('rejects oversized waypoint batches in the service', () => {
    expect(() => generateIftaReport({
      truckId: 'TRUCK-1',
      waypoints: Array.from({ length: MAX_IFTA_WAYPOINTS + 1 }, (_, index) => waypoint(index)),
    })).toThrow(new RegExp(`at most ${MAX_IFTA_WAYPOINTS}`));
  });

  it('rejects oversized fuel purchase batches in the service', () => {
    expect(() => generateIftaReport({
      truckId: 'TRUCK-1',
      waypoints: [waypoint(0), waypoint(1)],
      fuelPurchases: Array.from({ length: MAX_IFTA_FUEL_PURCHASES + 1 }, () => ({
        jurisdictionState: 'TX',
        gallons: 1,
        taxPaidUSD: 1,
      })),
    })).toThrow(new RegExp(`at most ${MAX_IFTA_FUEL_PURCHASES}`));
  });

  it('returns 413 for an oversized waypoint array', async () => {
    const res = await request(makeApp())
      .post('/api/ifta-tax/generate-report')
      .send({
        truckId: 'TRUCK-1',
        waypoints: Array.from({ length: MAX_IFTA_WAYPOINTS + 1 }, (_, index) => waypoint(index)),
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/at most/);
  });

  it('returns 413 for an oversized fuel purchase array', async () => {
    const res = await request(makeApp())
      .post('/api/ifta-tax/generate-report')
      .send({
        truckId: 'TRUCK-1',
        waypoints: [waypoint(0), waypoint(1)],
        fuelPurchases: Array.from({ length: MAX_IFTA_FUEL_PURCHASES + 1 }, () => ({
          jurisdictionState: 'TX',
          gallons: 1,
          taxPaidUSD: 1,
        })),
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/at most/);
  });

  it('still generates a report for a normal batch', async () => {
    const res = await request(makeApp())
      .post('/api/ifta-tax/generate-report')
      .send({
        truckId: 'TRUCK-1',
        waypoints: [waypoint(0), waypoint(1)],
        fuelPurchases: [{ jurisdictionState: 'TX', gallons: 2, taxPaidUSD: 4 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.truckId).toBe('TRUCK-1');
  });
});
