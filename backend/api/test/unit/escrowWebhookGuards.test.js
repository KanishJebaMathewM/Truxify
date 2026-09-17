import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) } },
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
    then: (resolve) => resolve(result.data ? { data: [result.data], error: result.error } : result),
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

/**
 * Unit Tests for escrowWebhookGuards.js
 * 
 * Verifies payload validation, order state updates, and idempotency.
 * Updated to reflect current implementation where payload validation
 * (orderId check) runs before any legacy simulation branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processEscrowWebhookEvent } from '../../src/services/webhook/escrowWebhookGuards.js';
import {
  createValidPaymentReleasedPayload,
  createValidPaymentReleasedPayloadNoTxHash,
  createInvalidPayloadMissingOrderId,
  createMockOrder
} from '../fixtures/escrowWebhookFixtures.js';
import { createChainableMock, setupDbMock } from './__mocks__/escrowWebhookMock.js';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    supabaseAdmin: {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    }
  },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  get supabase() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('escrowWebhookGuards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
  });

  it('throws when event type is missing', async () => {
    await expect(processEscrowWebhookEvent('')).rejects.toThrow('Missing escrow webhook event type');
    await expect(processEscrowWebhookEvent(null)).rejects.toThrow('Missing escrow webhook event type');
  });

  it('throws when orderId is missing in payload (validates before simulation)', async () => {
    const payload = createInvalidPayloadMissingOrderId();
    await expect(processEscrowWebhookEvent('PaymentReleased', payload))
      .rejects.toThrow('Missing orderId in escrow webhook payload');
  });

  it('acknowledges unknown event types without state change', async () => {
    const payload = createValidPaymentReleasedPayload();
    const result = await processEscrowWebhookEvent('SomeUnknownEvent', payload);
    expect(result).toEqual({ received: true, status: 'unknown_event' });
  });

  it('marks a funded order released on PaymentReleased with txHash', async () => {
    const order = createMockOrder({ escrow_status: 'funded' });
    const payload = createValidPaymentReleasedPayload({ orderId: order.order_display_id });

    const q = createChainableMock({ data: order, error: null });
    q.update.mockReturnValue(q);
    setupDbMock(dbMock, { data: order, error: null });

    const result = await processEscrowWebhookEvent('PaymentReleased', payload);

    expect(result.received).toBe(true);
    expect(result.status).toBe('released');
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({
      escrow_status: 'released',
      release_tx_hash: payload.txHash
    }));
  });

  it('marks a funded order released on PaymentReleased without a txHash', async () => {
    const order = createMockOrder({ escrow_status: 'funded', release_tx_hash: null });
    const payload = createValidPaymentReleasedPayloadNoTxHash({ orderId: order.order_display_id });

    const q = createChainableMock({ data: order, error: null });
    q.update.mockReturnValue(q);
    setupDbMock(dbMock, { data: order, error: null });

    const result = await processEscrowWebhookEvent('PaymentReleased', payload);

    expect(result.received).toBe(true);
    expect(result.status).toBe('released');
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({
      escrow_status: 'released'
    }));
  });

  it('reconciles an already-released order idempotently', async () => {
    const order = createMockOrder({
      escrow_status: 'released',
      release_tx_hash: '0xabc'
    });
    const payload = createValidPaymentReleasedPayload({ orderId: order.order_display_id });

    setupDbMock(dbMock, { data: order, error: null });

    const result = await processEscrowWebhookEvent('PaymentReleased', payload);

    expect(result.received).toBe(true);
    expect(result.status).toBe('already_released');
  });

  it('throws when no order is found', async () => {
    const payload = createValidPaymentReleasedPayload({ orderId: 'missing' });
    setupDbMock(dbMock, { data: null, error: null });

    await expect(processEscrowWebhookEvent('PaymentReleased', payload))
      .rejects.toThrow('No order found');
  });

  it('throws when the order query errors', async () => {
    const payload = createValidPaymentReleasedPayload();
    setupDbMock(dbMock, { data: null, error: { message: 'db down' } });

    await expect(processEscrowWebhookEvent('PaymentReleased', payload))
      .rejects.toThrow('Failed to load order');
  });
});
