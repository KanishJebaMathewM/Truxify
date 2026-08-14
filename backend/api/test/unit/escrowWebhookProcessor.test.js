import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockGetTransactionReceipt = vi.fn();
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(function JsonRpcProvider() {
      this.getTransactionReceipt = mockGetTransactionReceipt;
    }),
  },
}));


const mockQuery = {
  select: vi.fn(function () { return this; }),
  eq: vi.fn(function () { return this; }),
  in: vi.fn(function () { return this; }),
  update: vi.fn(function () { return this; }),
  limit: vi.fn(function () { return this; }),
  maybeSingle: vi.fn(),
};

const mockSupabaseAdmin = {
  from: vi.fn(() => mockQuery),
};

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

const { processEscrowWebhookEvent } = await import('../../src/services/webhook/escrowWebhookProcessor.js');

describe('processEscrowWebhookEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.maybeSingle.mockReset();
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.example';
    process.env.ESCROW_CONTRACT_ADDRESS = '0xEscrowContract000000000000000000000001';
    mockGetTransactionReceipt.mockResolvedValue({
      status: 1,
      to: '0xEscrowContract000000000000000000000001',
    });
  });

  it('acknowledges unsupported escrow events without changing state', async () => {
    await expect(
      processEscrowWebhookEvent('EscrowDeposited', { orderId: 'order-1' })
    ).resolves.toEqual({ received: true });
    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('keeps processor failures visible to the DLQ retry loop', async () => {
    await expect(
      processEscrowWebhookEvent('PaymentReleased', {})
    ).rejects.toThrow('Missing orderId in escrow webhook payload');
  });

  it('rejects payloads without an event type', async () => {
    await expect(processEscrowWebhookEvent(undefined, { orderId: 'order-1' }))
      .rejects.toThrow('Missing escrow webhook event type');
  });

  it('rejects payloads without an orderId', async () => {
    mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(processEscrowWebhookEvent('PaymentReleased', {}))
      .rejects.toThrow('Missing orderId in escrow webhook payload');
  });

  it('throws when no order matches the supplied orderId', async () => {
    mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: 'unknown-order' }))
      .rejects.toThrow('No order found for escrow webhook event');
  });

  it('marks the order released and reconciles the wallet ledger on PaymentReleased', async () => {
    const order = {
      id: 'order-uuid',
      order_display_id: '#OD1',
      driver_id: 'driver-1',
      escrow_status: 'funded',
      release_tx_hash: null,
      refund_tx_hash: null,
    };
    mockQuery.maybeSingle.mockResolvedValue({ data: order, error: null });

    await expect(
      processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: '0xabc' })
    ).resolves.toEqual({ received: true });

    expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('orders');
    expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      escrow_status: 'released',
      release_tx_hash: '0xabc',
    }));
    expect(mockQuery.in).toHaveBeenCalledWith('escrow_status', ['funded', 'release_failed']);

    const walletTables = mockSupabaseAdmin.from.mock.calls.filter(([table]) => table === 'wallet_transactions');
    expect(walletTables.length).toBeGreaterThan(0);
  });

  it('rejects PaymentReleased when the Polygon receipt is missing or failed', async () => {
    mockGetTransactionReceipt.mockResolvedValueOnce(null);

    await expect(
      processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: '0xdead' })
    ).rejects.toThrow('Polygon transaction receipt not found');

    mockGetTransactionReceipt.mockResolvedValueOnce({
      status: 0,
      to: '0xEscrowContract000000000000000000000001',
    });

    await expect(
      processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: '0xdead' })
    ).rejects.toThrow('Polygon transaction failed or reverted');

    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('marks the order refunded on BookingCancelled', async () => {
    const order = {
      id: 'order-uuid',
      order_display_id: '#OD2',
      driver_id: null,
      escrow_status: 'refund_pending',
      release_tx_hash: null,
      refund_tx_hash: null,
    };
    mockQuery.maybeSingle.mockResolvedValue({ data: order, error: null });

    await expect(
      processEscrowWebhookEvent('BookingCancelled', { orderId: '#OD2', txHash: '0xdef' })
    ).resolves.toEqual({ received: true });

    expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      escrow_status: 'refunded',
      refund_tx_hash: '0xdef',
    }));
    expect(mockQuery.in).toHaveBeenCalledWith('escrow_status', ['funded', 'refund_pending', 'refund_failed']);
  });

  it('settles a funded order as released on WithdrawalReady', async () => {
    const order = {
      id: 'order-uuid',
      order_display_id: '#OD3',
      driver_id: 'driver-3',
      escrow_status: 'funded',
      release_tx_hash: null,
      refund_tx_hash: null,
    };
    mockQuery.maybeSingle.mockResolvedValue({ data: order, error: null });

    await expect(
      processEscrowWebhookEvent('WithdrawalReady', { orderId: '#OD3', txHash: '0x111' })
    ).resolves.toEqual({ received: true });

    expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      escrow_status: 'released',
      release_tx_hash: '0x111',
    }));
  });

  it('settles a pending refund as refunded on Withdrawn', async () => {
    const order = {
      id: 'order-uuid',
      order_display_id: '#OD4',
      driver_id: null,
      escrow_status: 'refund_pending',
      release_tx_hash: null,
      refund_tx_hash: null,
    };
    mockQuery.maybeSingle.mockResolvedValue({ data: order, error: null });

    await expect(
      processEscrowWebhookEvent('Withdrawn', { orderId: '#OD4', txHash: '0x222' })
    ).resolves.toEqual({ received: true });

    expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      escrow_status: 'refunded',
      refund_tx_hash: '0x222',
    }));
  });
});

describe('processEscrowWebhookEvent — idempotency (crash-after-side-effect / duplicate delivery)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.maybeSingle.mockReset();
  });

  const updatePayloads = () => mockQuery.update.mock.calls.map(([payload]) => payload);

  it('ignores a duplicate PaymentReleased when the order is already released (no re-applied order effect)', async () => {
    // Simulates worker A having already applied the side effect before
    // crashing; worker B re-processes the reclaimed DLQ row.
    const order = {
      id: 'order-uuid',
      order_display_id: '#OD5',
      driver_id: 'driver-5',
      escrow_status: 'released',
      release_tx_hash: '0xabc',
      refund_tx_hash: null,
    };
    mockQuery.maybeSingle.mockResolvedValue({ data: order, error: null });

    await expect(
      processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD5', txHash: '0xabc' })
    ).resolves.toEqual({ received: true });

    // The order-level effect is NOT re-applied…
    expect(updatePayloads().filter(p => p.escrow_status === 'released')).toHaveLength(0);
    // …but the (idempotent) wallet ledger confirm still runs, healing a crash
    // between the order update and the wallet update.
    expect(updatePayloads().some(p => p.status === 'confirmed')).toBe(true);
  });

  it('ignores a duplicate BookingCancelled when the order is already refunded', async () => {
    const order = {
      id: 'order-uuid',
      order_display_id: '#OD6',
      driver_id: null,
      escrow_status: 'refunded',
      release_tx_hash: null,
      refund_tx_hash: '0xdef',
    };
    mockQuery.maybeSingle.mockResolvedValue({ data: order, error: null });

    await expect(
      processEscrowWebhookEvent('BookingCancelled', { orderId: '#OD6', txHash: '0xdef' })
    ).resolves.toEqual({ received: true });

    expect(updatePayloads().filter(p => p.escrow_status === 'refunded')).toHaveLength(0);
  });

  it('ignores a duplicate WithdrawalReady when the order is already released', async () => {
    const order = {
      id: 'order-uuid',
      order_display_id: '#OD7',
      driver_id: 'driver-7',
      escrow_status: 'released',
      release_tx_hash: '0x111',
      refund_tx_hash: null,
    };
    mockQuery.maybeSingle.mockResolvedValue({ data: order, error: null });

    await expect(
      processEscrowWebhookEvent('WithdrawalReady', { orderId: '#OD7' })
    ).resolves.toEqual({ received: true });

    expect(updatePayloads().filter(p => p.escrow_status === 'released')).toHaveLength(0);
  });
});
