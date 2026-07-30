import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { processEscrowWebhookEvent } = await import('../../src/services/webhook/escrowWebhookProcessor.js');

describe('processEscrowWebhookEvent', () => {
  it('processes supported escrow events without limiting retries to refunds', async () => {
    await expect(
      processEscrowWebhookEvent('EscrowDeposited', { orderId: 'order-1' })
    ).resolves.toEqual({ received: true });
  });

  it('keeps processor failures visible to the DLQ retry loop', async () => {
    await expect(
      processEscrowWebhookEvent('EscrowDeposited', {
        orderId: 'order-1',
        simulateFailure: true,
      })
    ).rejects.toThrow('Simulated database lock or processing failure');
  });
});
