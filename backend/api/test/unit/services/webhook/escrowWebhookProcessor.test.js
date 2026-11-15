import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();

vi.mock('../../../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/services/webhook/escrowVerification.js', () => ({
  normalizeTxHash: vi.fn((h) => h),
  verifyPolygonEscrowTransaction: vi.fn(),
  verifyPolygonWithdrawalTransaction: vi.fn(),
  EscrowVerificationError: class EscrowVerificationError extends Error {},
}));

describe('escrowWebhookProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReset();
  });

  describe('processEscrowWebhookEvent', () => {
    it('throws when eventType is missing', async () => {
      const { processEscrowWebhookEvent } = await import('../../../../src/services/webhook/escrowWebhookProcessor.js');
      await expect(processEscrowWebhookEvent(null)).rejects.toThrow('Missing escrow webhook event type');
      await expect(processEscrowWebhookEvent('')).rejects.toThrow('Missing escrow webhook event type');
    });

    it('returns received=true for unknown event types without throwing', async () => {
      const { processEscrowWebhookEvent } = await import('../../../../src/services/webhook/escrowWebhookProcessor.js');
      const result = await processEscrowWebhookEvent('UnknownEvent', { orderId: 'order-1' });
      expect(result).toEqual({ received: true });
    });

    it('throws when txHash is missing for PaymentReleased event', async () => {
      const { processEscrowWebhookEvent } = await import('../../../../src/services/webhook/escrowWebhookProcessor.js');
      await expect(processEscrowWebhookEvent('PaymentReleased', {})).rejects.toThrow(
        'Missing txHash in escrow release webhook payload — release requires on-chain proof'
      );
    });
  });
});
