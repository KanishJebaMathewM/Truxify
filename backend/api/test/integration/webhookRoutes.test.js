import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

import webhookRoutes from '../../src/routes/webhookRoutes.js';
import { dlqService } from '../../src/services/webhook/dlqService.js';

function buildApp(webhookRouter, { autoSignReplayMetadata = false } = {}) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

  if (autoSignReplayMetadata) {
    app.use((req, _res, next) => {
      const signature = req.headers['x-webhook-signature'];
      const hasTimestamp = Boolean(req.headers['x-escrow-timestamp']);
      const hasNonce = Boolean(req.headers['x-escrow-nonce']);
      if (
        req.path === '/api/webhooks/escrow'
        && process.env.WEBHOOK_SECRET
        && signature
        && signature.length === 64
        && (!hasTimestamp || !hasNonce)
      ) {
        const timestamp = String(Date.now());
        const nonce = crypto.randomUUID();
        req.headers['x-escrow-timestamp'] = timestamp;
        req.headers['x-escrow-nonce'] = nonce;
        req.headers['x-webhook-signature'] = crypto
          .createHmac('sha256', process.env.WEBHOOK_SECRET)
          .update(`${timestamp}.${nonce}.${req.rawBody}`)
          .digest('hex');
      }
      next();
    });
  }

  app.use('/api/webhooks', webhookRouter);
  return app;
}

describe('Webhook Routes', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('POST /api/webhooks/escrow (no WEBHOOK_SECRET)', () => {
    const app = buildApp(webhookRoutes);

    it('rejects requests when WEBHOOK_SECRET is unset', async () => {
      const enqueueSpy = vi.spyOn(dlqService, 'enqueueFailure').mockResolvedValue(true);
      const res = await request(app).post('/api/webhooks/escrow').send({
        eventType: 'EscrowRefunded', orderId: 'test-123', txHash: '0x123'
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Webhook secret not configured');
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('rejects requests when WEBHOOK_SECRET is unset even on processing failure', async () => {
      const enqueueSpy = vi.spyOn(dlqService, 'enqueueFailure').mockResolvedValue(true);
      const res = await request(app).post('/api/webhooks/escrow').send({ eventType: 'PaymentReleased' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Webhook secret not configured');
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown webhook paths', async () => {
      const res = await request(app).post('/api/webhooks/unknown').send({ eventType: 'Test' });
      expect(res.status).toBe(404);
    });
  });
});

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
    vi.doMock('../../src/services/webhook/escrowWebhookProcessor.js', () => ({
      processEscrowWebhookEvent: vi.fn(async (_eventType, payload = {}) => {
        if (payload.simulateFailure) throw new Error('Simulated database lock or processing failure');
        if (payload.permanentError) {
          const err = new Error('Transaction 0x123 does not target the escrow contract 0xdeadbeef');
          err.code = 'WRONG_CONTRACT';
          err.retryable = false;
          throw err;
        }
        return { received: true };
      }),
    }));

    const mod = await import('../../src/routes/webhookRoutes.js');
    webhookRouter = mod.default;
    app = buildApp(webhookRouter, { autoSignReplayMetadata: true });
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function signPayload(body, timestamp = Date.now(), nonce = crypto.randomUUID()) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      signature: crypto.createHmac('sha256', WEBHOOK_SECRET)
        .update(`${timestamp}.${nonce}.${rawBody}`).digest('hex'),
      timestamp,
      nonce,
    };
  }

  describe('POST /api/webhooks/escrow', () => {
    it('returns 200 when valid HMAC signature is provided', async () => {
      const payload = { eventType: 'EscrowFunded', orderId: 'order-456', txHash: '0xabc' };
      const { signature, timestamp, nonce } = signPayload(payload);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockEnqueueFailure).not.toHaveBeenCalled();
    });

    it('returns 401 when signature header is missing', async () => {
      const res = await request(app).post('/api/webhooks/escrow').send({ eventType: 'EscrowFunded' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Missing X-Webhook-Signature header');
    });

    it('returns 401 when signature is invalid', async () => {
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', 'invalid-signature-value')
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce)
        .send({ eventType: 'EscrowFunded' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 401 when signature has wrong length', async () => {
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', 'abc123')
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce)
        .send({ eventType: 'EscrowFunded' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 401 when signature does not match the payload', async () => {
      const payload = { eventType: 'EscrowFunded', orderId: 'order-456', txHash: '0xabc' };
      const { signature, timestamp, nonce } = signPayload({ ...payload, orderId: 'tampered-order' });
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 401 when replay-protection headers are missing', async () => {
      const noReplayHeaderApp = buildApp(webhookRouter);
      const payload = { eventType: 'EscrowFunded', orderId: 'order-456', txHash: '0xabc' };
      const { signature } = signPayload(payload);
      const res = await request(noReplayHeaderApp).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature).send(payload);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Missing replay-protection headers');
    });

    it('returns 401 when timestamp is changed after signing', async () => {
      const payload = { eventType: 'EscrowFunded' };
      const { signature, timestamp, nonce } = signPayload(payload);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp + 1))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 401 when nonce is changed after signing', async () => {
      const payload = { eventType: 'EscrowFunded' };
      const { signature, timestamp } = signPayload(payload);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', crypto.randomUUID()).send(payload);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid webhook signature');
    });

    it('returns 401 for a stale signed webhook', async () => {
      const payload = { eventType: 'EscrowFunded' };
      const { signature, timestamp, nonce } = signPayload(payload, Date.now() - 6 * 60 * 1000);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Webhook timestamp outside accepted window');
    });

    it('returns 401 for a future signed webhook', async () => {
      const payload = { eventType: 'EscrowFunded' };
      const { signature, timestamp, nonce } = signPayload(payload, Date.now() + 6 * 60 * 1000);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Webhook timestamp outside accepted window');
    });

    it('returns 401 when the same nonce is replayed', async () => {
      const payload = { eventType: 'EscrowFunded' };
      const headers = signPayload(payload);
      const send = () => request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', headers.signature)
        .set('X-Escrow-Timestamp', String(headers.timestamp))
        .set('X-Escrow-Nonce', headers.nonce).send(payload);
      const first = await send();
      const second = await send();
      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      expect(second.body.error).toBe('Webhook nonce already used (replay)');
    });

    it('returns 202 and enqueues to DLQ on processing failure with valid signature', async () => {
      const payload = { eventType: 'PaymentReleased', simulateFailure: true };
      const { signature, timestamp, nonce } = signPayload(payload);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(202);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('queued_for_retry');
      expect(mockEnqueueFailure).toHaveBeenCalledWith('escrow', 'PaymentReleased', expect.any(Object), expect.any(Error));
    });

    it('returns 500 instead of 202 when the DLQ enqueue fails', async () => {
      mockEnqueueFailure.mockResolvedValueOnce(false);
      const payload = { eventType: 'PaymentReleased', simulateFailure: true };
      const { signature, timestamp, nonce } = signPayload(payload);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Webhook processing failed and the event could not be queued for retry');
      expect(mockEnqueueFailure).toHaveBeenCalledTimes(1);
    });

    it('does not leak internal processing details back to the webhook provider (retryable)', async () => {
      const payload = { eventType: 'PaymentReleased', orderId: 'order-777', txHash: `0x${'ab'.repeat(32)}`, simulateFailure: true };
      const { signature, timestamp, nonce } = signPayload(payload);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('queued_for_retry');
      expect(res.body.error).toContain('order-777');
      expect(res.body.error).not.toContain('Simulated database lock');
      expect(res.body.error).not.toContain('database');
    });

    it('dead-letters permanent verification failures and exposes only a safe code', async () => {
      const payload = { eventType: 'PaymentReleased', orderId: 'order-888', txHash: `0x${'cd'.repeat(32)}`, permanentError: true };
      const { signature, timestamp, nonce } = signPayload(payload);
      const res = await request(app).post('/api/webhooks/escrow')
        .set('X-Webhook-Signature', signature)
        .set('X-Escrow-Timestamp', String(timestamp))
        .set('X-Escrow-Nonce', nonce).send(payload);
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('dead_lettered');
      expect(res.body.error).toContain('WRONG_CONTRACT');
      expect(res.body.error).not.toContain('0x123');
      expect(res.body.error).not.toContain('0xdeadbeef');
      expect(mockEnqueueFailure).toHaveBeenCalledTimes(1);
    });
  });
});

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
    const res = await request(app).post('/api/webhooks/escrow').send({
      eventType: 'EscrowFunded', orderId: 'order-999', txHash: '0x111'
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Webhook secret not configured');
  });
});
