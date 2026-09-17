import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { requireRole, pruneDevices } = vi.hoisted(() => ({
  requireRole: vi.fn((allowedRoles) => (req, res, next) => {
    if (allowedRoles.includes(req.user?.role)) {
      return next();
    }

    return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
  }),
  pruneDevices: vi.fn((req, res) => {
    res.status(200).json({
      success: true,
      message: 'Successfully pruned 2 stale devices',
      pruned: 2,
    });
  }),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      role: req.headers['x-test-role'] || 'customer',
    };
    next();
  },
  requireRole,
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  deviceLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/validation/requestSchemas.js', () => ({
  registerDeviceSchema: {},
  unregisterDeviceSchema: {},
}));

vi.mock('../../src/controllers/deviceController.js', () => ({
  registerDeviceToken: vi.fn(),
  unregisterDeviceToken: vi.fn(),
  getDevicePlatforms: vi.fn(),
  pruneDevices,
}));

import deviceRoutes from '../../src/routes/deviceRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/devices', deviceRoutes);
  return app;
}

describe('device pruning authorization', () => {
  beforeEach(() => {
    pruneDevices.mockClear();
  });

  it('registers the pruning route with an admin-only role guard', () => {
    expect(requireRole).toHaveBeenCalledWith(['admin']);
  });

  it('rejects customer requests before pruning executes', async () => {
    const res = await request(makeApp())
      .post('/devices/prune')
      .set('x-test-role', 'customer')
      .query({ days: 30 });

    expect(res.status).toBe(403);
    expect(pruneDevices).not.toHaveBeenCalled();
  });

  it('rejects driver requests before pruning executes', async () => {
    const res = await request(makeApp())
      .post('/devices/prune')
      .set('x-test-role', 'driver')
      .query({ days: 30 });

    expect(res.status).toBe(403);
    expect(pruneDevices).not.toHaveBeenCalled();
  });

  it('allows admin requests to reach the pruning controller', async () => {
    const res = await request(makeApp())
      .post('/devices/prune')
      .set('x-test-role', 'admin')
      .query({ days: 30 });

    expect(res.status).toBe(200);
    expect(res.body.pruned).toBe(2);
    expect(pruneDevices).toHaveBeenCalledTimes(1);
  });
});
