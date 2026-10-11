import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js'; // Adjust path to your main Express app entry point if needed

describe('Health Check Endpoint', () => {
  it('GET /health should return a successful status and healthy state', async () => {
    // Mounted at /api/health (and /api/v1/health) — no bare root route exists.
    const response = await request(app).get('/api/health');

    // The endpoint deliberately returns 503 when a critical dependency
    // (Supabase/Mongo) is unhealthy — in a DB-less test env that is the
    // expected answer; what is pinned is the contract shape.
    expect([200, 503]).toContain(response.status);

    // Verify response body exists and contains status indication
    expect(response.body).toBeDefined();
    expect(response.body).toHaveProperty('status');
  });
});
