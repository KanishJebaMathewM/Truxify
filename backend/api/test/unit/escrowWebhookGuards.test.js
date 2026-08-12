import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  get supabase() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { processEscrowWebhookEvent } from '../../src/services/webhook/escrowWebhookProcessor.js';

function chain(result) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    update: vi.fn(() => q),
  };
  return q;
}

describe('escrowWebhookProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
  });

  it('throws when event type is missing', async () => {
    await expect(processEscrowWebhookEvent('')).rejects.toThrow('Missing escrow webhook event type');
  });

  it('throws on simulated failure', async () => {
    await expect(processEscrowWebhookEvent('PaymentReleased', { simulateFailure: true })).rejects.toThrow('Simulated database lock or processing failure');
  });

  it('acknowledges unknown event types without state change', async () => {
    const result = await processEscrowWebhookEvent('SomeUnknownEvent', { orderId: 'o1' });
    expect(result).toEqual({ received: true });
  });

  it('marks a funded order released on PaymentReleased without a txHash', async () => {
    const order = { id: 'o1', order_display_id: 'TX-1', driver_id: null, escrow_status: 'funded', release_tx_hash: null, refund_tx_hash: null };
    const q = chain({ data: order, error: null });
    q.update.mockReturnValue(q);
    dbMock.supabaseAdmin.from.mockReturnValue(q);

    const result = await processEscrowWebhookEvent('PaymentReleased', { orderId: 'TX-1' });
    expect(result.received).toBe(true);
    // The order update should have been issued
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ escrow_status: 'released' }));
  });

  it('reconciles an already-released order idempotently', async () => {
    const order = { id: 'o1', order_display_id: 'TX-1', driver_id: null, escrow_status: 'released', release_tx_hash: '0xabc' };
    dbMock.supabaseAdmin.from.mockReturnValue(chain({ data: order, error: null }));
    const result = await processEscrowWebhookEvent('PaymentReleased', { orderId: 'TX-1' });
    expect(result.received).toBe(true);
  });

  it('throws when no order is found', async () => {
    dbMock.supabaseAdmin.from.mockReturnValue(chain({ data: null, error: null }));
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: 'missing' })).rejects.toThrow('No order found');
  });

  it('throws when the order query errors', async () => {
    dbMock.supabaseAdmin.from.mockReturnValue(chain({ data: null, error: { message: 'db down' } }));
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: 'o1' })).rejects.toThrow('Failed to load order');
  });
});
