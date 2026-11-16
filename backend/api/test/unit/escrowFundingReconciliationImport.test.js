import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  redisClient: null,
  supabaseAdmin: null,
}));

vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: vi.fn(),
  getOnChainEscrowBooking: vi.fn(),
  weiWithinTolerance: vi.fn(),
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  renewLock: vi.fn(),
  releaseLock: vi.fn(),
  withLockRenewal: vi.fn(),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
}));

describe('escrowFundingReconciliation module evaluation', () => {
  it('exports the reconciliation entry points without evaluating dead top-level code', async () => {
    const mod = await import('../../src/services/escrowFundingReconciliation.js');

    expect(typeof mod.startEscrowFundingReconciliation).toBe('function');
    expect(typeof mod.reconcileStaleFunding).toBe('function');
    expect(typeof mod.processQueue).toBe('function');
  });
});
