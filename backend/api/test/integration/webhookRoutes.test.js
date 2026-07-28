import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import webhookRoutes from '../../src/routes/webhookRoutes.js';
import { dlqService } from '../../src/services/webhook/dlqService.js';

const app = express();
app.use(express.json());
app.use('/api/webhooks', webhookRoutes);

describe('Webhook Routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/webhooks/escrow', () => {
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
  });
});
