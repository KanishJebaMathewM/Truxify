import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

vi.mock('../../src/services/webhook/dlqService.js', () => ({
  dlqService: {
    enqueueFailure: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../src/services/webhook/escrowWebhookProcessor.js', () => ({
  processEscrowWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('webhookRoutes', () => {
  let app;
  const WEBHOOK_SECRET = 'test-secret-12345';

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('WEBHOOK_SECRET', WEBHOOK_SECRET);
    const webhookRoutes = (await import('../../src/routes/webhookRoutes.js')).default;
    app = express();
    app.use(express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }));
    app.use('/api/webhooks', webhookRoutes);
  });

  function makeSignature(body, timestamp, nonce) {
    return crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest('hex');
  }

  it('POST /escrow rejects request without X-Webhook-Signature header', async () => {
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .send({ eventType: 'ORDER_CREATED' });
    expect(res.status).toBe(401);
  });

  it('POST /escrow rejects request with invalid signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', 'invalid-signature')
      .set('Content-Type', 'application/json')
      .send({ eventType: 'ORDER_CREATED' });
    expect(res.status).toBe(401);
  });

  it('POST /escrow returns 500 when WEBHOOK_SECRET is not configured', async () => {
    vi.stubEnv('WEBHOOK_SECRET', '');
    const webhookRoutes = (await import('../../src/routes/webhookRoutes.js')).default;
    const app2 = express();
    app2.use(express.json());
    app2.use('/api/webhooks', webhookRoutes);
    const res = await request(app2)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', 'any')
      .set('Content-Type', 'application/json')
      .send({ eventType: 'ORDER_CREATED' });
    expect(res.status).toBe(500);
  });

  it('POST /escrow accepts valid signed request', async () => {
    const payload = { eventType: 'ORDER_CREATED', orderId: 'order-123', txHash: '0xabc' };
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const nonce = 'unit-test-valid-nonce';
    const sig = makeSignature(body, timestamp, nonce);
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', sig)
      .set('x-escrow-timestamp', String(timestamp))
      .set('x-escrow-nonce', nonce)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('received', true);
  });

  it('rejects a valid body signature when timestamp is changed', async () => {
    const payload = { eventType: 'ORDER_CREATED' };
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const nonce = 'unit-test-timestamp-binding';
    const sig = makeSignature(body, timestamp, nonce);
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', sig)
      .set('x-escrow-timestamp', String(timestamp + 1))
      .set('x-escrow-nonce', nonce)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid webhook signature');
  });

  it('rejects a valid body signature when nonce is changed', async () => {
    const payload = { eventType: 'ORDER_CREATED' };
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const sig = makeSignature(body, timestamp, 'unit-test-original-nonce');
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', sig)
      .set('x-escrow-timestamp', String(timestamp))
      .set('x-escrow-nonce', 'unit-test-replaced-nonce')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid webhook signature');
  });

  it('rejects stale signed requests', async () => {
    const payload = { eventType: 'ORDER_CREATED' };
    const body = JSON.stringify(payload);
    const timestamp = Date.now() - (6 * 60 * 1000);
    const nonce = 'unit-test-stale-nonce';
    const sig = makeSignature(body, timestamp, nonce);
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', sig)
      .set('x-escrow-timestamp', String(timestamp))
      .set('x-escrow-nonce', nonce)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Webhook timestamp outside accepted window');
  });

  it('rejects future signed requests', async () => {
    const payload = { eventType: 'ORDER_CREATED' };
    const body = JSON.stringify(payload);
    const timestamp = Date.now() + (6 * 60 * 1000);
    const nonce = 'unit-test-future-nonce';
    const sig = makeSignature(body, timestamp, nonce);
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', sig)
      .set('x-escrow-timestamp', String(timestamp))
      .set('x-escrow-nonce', nonce)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Webhook timestamp outside accepted window');
  });
});
