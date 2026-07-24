import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Tests WITHOUT WEBHOOK_SECRET (verification skipped in non-production)
// ---------------------------------------------------------------------------
import webhookRoutes from '../../src/routes/webhookRoutes.js';
import { dlqService } from '../../src/services/webhook/dlqService.js';

function buildApp(webhookRouter) {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', webhookRouter);
  return app;
}

describe('Webhook Routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/webhooks/escrow (no WEBHOOK_SECRET)', () => {
    const app = buildApp(webhookRoutes);

    it('returns 200 on successful processing', async () => {
      const enqueueSpy = vi.spyOn(dlqService, 'enqueueFailure').mockResolvedValue(true);
      const res = await request(app)
        .post('/api/webhooks/escrow')
        .send({
          eventType: 'EscrowRefunded',
          orderId: 'test-123',
          txHash: '0x123'
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('returns 202 and enqueues to DLQ on processing failure', async () => {
      const enqueueSpy = vi.spyOn(dlqService, 'enqueueFailure').mockResolvedValue(true);
      const res = await request(app)
        .post('/api/webhooks/escrow')
        .send({
          eventType: 'EscrowRefunded',
          orderId: 'test-123',
          txHash: '0x123',
          simulateFailure: true
        });

      expect(res.status).toBe(202);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('queued_for_retry');

      expect(enqueueSpy).toHaveBeenCalledWith(
        'escrow',
        'EscrowRefunded',
        expect.any(Object),
        expect.any(Error)
      );
    });

    it('returns 404 for unknown webhook paths', async () => {
      const res = await request(app)
        .post('/api/webhooks/unknown')
        .send({ eventType: 'Test' });

      expect(res.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests WITH WEBHOOK_SECRET (HMAC signature verification)
//
// vi.resetModules() is needed because WEBHOOK_SECRET is captured at module
// load time. To test HMAC verification we re-import the route module after
// setting the env var. The dlqService must also be mocked so the re-imported
// route module gets the same stubbed instance.
// ---------------------------------------------------------------------------
describe('Webhook Routes — HMAC Signature Verification', () => {
  const WEBHOOK_SECRET = 'test-webhook-secret-key-for-hmac';

  let webhookRouter;
  let app;
  let mockEnqueueFailure;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockEnqueueFailure = vi.fn().mockResolvedValue(true);

    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';

    vi.resetModules();
    vi.doMock('../../src/services/webhook/dlqService.js', () => ({
      dlqService: { enqueueFailure: mockEnqueueFailure }
    }));

    const mod = await import('../../src/routes/webhookRoutes.js');
    webhookRouter = mod.default;
    app = buildApp(webhookRouter);
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function signPayload(body) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    return crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
  }

  describe('POST /api/webhooks/escrow', () => {
    it('returns 200 when valid HMAC signature is provided', async () => {
      const payload = {
        eventType: 'EscrowFunded',
        orderId: 'order-456',
        txHash: '0xabc'
      };
      const signature = signPayload(payload);

      const res = await request(app)
        .post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockEnqueueFailure).not.toHaveBeenCalled();
    });

    it('returns 401 when signature header is missing', async () => {
      const res = await request(app)
        .post('/api/webhooks/escrow')
        .send({
          eventType: 'EscrowFunded',
          orderId: 'order-456',
          txHash: '0xabc'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Missing X-Webhook-Signature header');
    });

    it('returns 401 when signature is invalid', async () => {
      const res = await request(app)
        .post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', 'invalid-signature-value')
        .send({
          eventType: 'EscrowFunded',
          orderId: 'order-456',
          txHash: '0xabc'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 401 when signature has wrong length', async () => {
      const res = await request(app)
        .post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', 'abc123')
        .send({
          eventType: 'EscrowFunded',
          orderId: 'order-456',
          txHash: '0xabc'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 401 when signature does not match the payload', async () => {
      const payload = {
        eventType: 'EscrowFunded',
        orderId: 'order-456',
        txHash: '0xabc'
      };
      const signature = signPayload({ ...payload, orderId: 'tampered-order' });

      const res = await request(app)
        .post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 202 and enqueues to DLQ on processing failure with valid signature', async () => {
      const payload = {
        eventType: 'EscrowReleased',
        orderId: 'order-789',
        txHash: '0xdef',
        simulateFailure: true
      };
      const signature = signPayload(payload);

      const res = await request(app)
        .post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('queued_for_retry');

      expect(mockEnqueueFailure).toHaveBeenCalledWith(
        'escrow',
        'EscrowReleased',
        expect.any(Object),
        expect.any(Error)
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Tests for WEBHOOK_SECRET not configured in production
// ---------------------------------------------------------------------------
describe('Webhook Routes — Production Secret Missing', () => {
  let webhookRouter;
  let app;

  beforeEach(async () => {
    vi.restoreAllMocks();
    delete process.env.WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';

    vi.resetModules();
    const mod = await import('../../src/routes/webhookRoutes.js');
    webhookRouter = mod.default;
    app = buildApp(webhookRouter);
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
    vi.resetModules();
  });

  it('returns 500 when WEBHOOK_SECRET is not set in production', async () => {
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .send({
        eventType: 'EscrowFunded',
        orderId: 'order-999',
        txHash: '0x111'
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Webhook secret not configured');
  });
});
