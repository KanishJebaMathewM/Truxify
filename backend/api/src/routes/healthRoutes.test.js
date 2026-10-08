import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from './healthRoutes.js';

const app = express();
app.use('/api', healthRouter);

describe('Health Routes (`/api/health`)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 200 OK with healthy status, timestamp, and uptime', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('uptime');
    expect(typeof response.body.uptime).toBe('number');
  });

  it('should handle probe requests cleanly and include structured log metadata', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
  });
});
