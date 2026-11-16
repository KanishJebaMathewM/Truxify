import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js'; // Adjust path to your main Express app entry point if needed

describe('Health Check Endpoint', () => {
  it('GET /health should return a successful status and healthy state', async () => {
    const response = await request(app).get('/health');

    // Verify successful HTTP status code
    expect(response.status).toBe(200);

    // Verify response body exists and contains status indication
    expect(response.body).toBeDefined();
    expect(response.body).toHaveProperty('status');
  });
});
