import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}));

const mockGetTransactionReceipt = vi.hoisted(() => vi.fn());

const verifierMock = vi.hoisted(() => ({ verifyEscrow: vi.fn(), verifyWithdrawal: vi.fn() }));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  get supabase() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal();
  class MockJsonRpcProvider {
    getTransactionReceipt(...args) { return mockGetTransactionReceipt(...args); }
    getTransaction(...args) { return mockGetTransactionReceipt(...args); }
    getBlockNumber() { return 195; }
  }
  return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: MockJsonRpcProvider } };
});

vi.mock('../../src/services/webhook/escrowVerification.js', () => ({
  EscrowVerificationError: class EscrowVerificationError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = 'EscrowVerificationError';
      this.code = code;
      this.retryable = options.retryable !== false;
    }
  },
  normalizeTxHash: (tx) => {
    if (typeof tx !== 'string') return null;
    const text = tx.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(text)) return null;
    return text.toLowerCase();
  },
  verifyPolygonEscrowTransaction: verifierMock.verifyEscrow,
  verifyPolygonWithdrawalTransaction: verifierMock.verifyWithdrawal,
}));

import { processEscrowWebhookEvent } from '../../src/services/webhook/escrowWebhookProcessor.js';

const TX = `0x${'ab'.repeat(32)}`;

function chain(result) {
  const filters = [];
  let didUpdate = false;
  const q = {
    select: vi.fn(() => {
      if (didUpdate) {
        return Promise.resolve({ data: [{}], error: null });
      }
      return q;
    }),
    eq: vi.fn((col, val) => { filters.push([col, val]); return q; }),
    neq: vi.fn(() => q),
    in: vi.fn(() => q),
    update: vi.fn(() => { didUpdate = true; return q; }),
    maybeSingle: vi.fn(() => {
      if (filters.some(([col]) => col === 'release_tx_hash' || col === 'refund_tx_hash')) {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve(result);
    }),
    then: (resolve) => resolve(result.data ? { data: [result.data], error: result.error } : result),
  };
  return q;
}

describe('escrowWebhookProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.example';
    process.env.ESCROW_CONTRACT_ADDRESS = '0xEscrowContract000000000000000000000001';
    mockGetTransactionReceipt.mockResolvedValue({ status: 1, to: '0xEscrowContract000000000000000000000001', logs: [] });
    verifierMock.verifyEscrow.mockResolvedValue({ ok: true, txHash: TX, blockNumber: 195, confirmations: 6 });
    verifierMock.verifyWithdrawal.mockResolvedValue({ ok: true, txHash: TX, blockNumber: 195, confirmations: 6 });
  });

  it('throws when event type is missing', async () => {
    await expect(processEscrowWebhookEvent('')).rejects.toThrow('Missing escrow webhook event type');
  });

  it('acknowledges unknown event types without state change', async () => {
    const result = await processEscrowWebhookEvent('SomeUnknownEvent', { orderId: 'o1' });
    expect(result).toEqual({ received: true });
  });

  it('marks a funded order released on PaymentReleased with a verified receipt', async () => {
    const order = { id: 'o1', order_display_id: 'TX-1', driver_id: null, escrow_status: 'funded', release_tx_hash: null, refund_tx_hash: null, escrow_amount_wei: 0, escrow_disabled: false, status: 'delivered' };
    const q = chain({ data: order, error: null });
    dbMock.supabaseAdmin.from.mockReturnValue(q);

    const result = await processEscrowWebhookEvent('PaymentReleased', { orderId: 'TX-1', txHash: TX });
    expect(result.received).toBe(true);
    // The order update should have been issued
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ escrow_status: 'released' }));
  });

  it('reconciles an already-released order idempotently', async () => {
    const order = { id: 'o1', order_display_id: 'TX-1', driver_id: null, escrow_status: 'released', release_tx_hash: TX };
    dbMock.supabaseAdmin.from.mockReturnValue(chain({ data: order, error: null }));
    const result = await processEscrowWebhookEvent('PaymentReleased', { orderId: 'TX-1', txHash: TX });
    expect(result.received).toBe(true);
  });

  it('throws when no order is found', async () => {
    dbMock.supabaseAdmin.from.mockReturnValue(chain({ data: null, error: null }));
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: 'missing', txHash: TX })).rejects.toThrow('No order found');
  });

  it('throws when the order query errors', async () => {
    dbMock.supabaseAdmin.from.mockReturnValue(chain({ data: null, error: { message: 'db down' } }));
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: 'o1', txHash: TX })).rejects.toThrow('Failed to load order');
  });
});
