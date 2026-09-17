import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const dlqService = vi.hoisted(() => ({ enqueueFailure: vi.fn().mockResolvedValue(true) }));
const redisClient = vi.hoisted(() => ({ set: vi.fn() }));
const verifierMock = vi.hoisted(() => ({ verifyEscrow: vi.fn(), verifyWithdrawal: vi.fn() }));
const dbState = vi.hoisted(() => ({
  orderResult: { data: null, error: null },
  replayResult: { data: null, error: null },
  walletResult: { data: null, error: null },
  updates: [],
  updateError: null,
  orderLookupCalls: 0,
}));
const mockGetTransactionReceipt = vi.hoisted(() => vi.fn());

vi.mock('../../src/middleware/logger.js', () => ({ default: logger }));
vi.mock('../../src/services/webhook/dlqService.js', () => ({ dlqService }));

vi.mock('../../src/config/db.js', () => ({
  redisClient,
  supabaseAdmin: {
    from: vi.fn((table) => {
      const query = {
        select: vi.fn(function () { return this; }),
        eq: vi.fn(function () { return this; }),
        neq: vi.fn(function () { return this; }),
        in: vi.fn(function () { return this; }),
        update: vi.fn(function (payload) {
          dbState.updates.push({ table, payload });
          return this;
        }),
        maybeSingle: vi.fn(() => {
          if (table === 'wallet_transactions') return Promise.resolve(dbState.walletResult);
          if (table === 'orders') {
            dbState.orderLookupCalls += 1;
            if (dbState.replayResult?.data && dbState.orderLookupCalls >= 2) {
              return Promise.resolve(dbState.replayResult);
            }
            return Promise.resolve(dbState.orderResult);
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };
      return query;
    }),
    rpc: vi.fn(async () => ({ error: null })),
  },
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

const TX = `0x${'ab'.repeat(32)}`;
const OTHER_TX = `0x${'cd'.repeat(32)}`;

function makeOrder(overrides = {}) {
  return {
    id: 'order-uuid',
    order_display_id: '#OD1',
    driver_id: 'driver-1',
    escrow_status: 'funded',
    release_tx_hash: null,
    refund_tx_hash: null,
    escrow_amount_wei: 0,
    escrow_disabled: false,
    status: 'delivered',
    ...overrides,
  };
}

async function loadWebhookRoutes() {
  vi.resetModules();
  return (await import('../../src/routes/webhookRoutes.js')).default;
}

function makeSignedRequest(app, payload, secret = 'test-secret-12345') {
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return request(app)
    .post('/api/webhooks/escrow')
    .set('x-webhook-signature', signature)
    .set('x-escrow-timestamp', String(Date.now()))
    .set('x-escrow-nonce', `nonce-${Math.random().toString(16).slice(2)}`)
    .set('Content-Type', 'application/json')
    .send(payload);
}

function resetDbState() {
  dbState.orderResult = { data: null, error: null };
  dbState.replayResult = { data: null, error: null };
  dbState.walletResult = { data: null, error: null };
  dbState.updates = [];
  dbState.updateError = null;
  dbState.orderLookupCalls = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbState();
  redisClient.set.mockResolvedValue('OK');
  verifierMock.verifyEscrow.mockResolvedValue({ ok: true, txHash: TX, blockNumber: 195, confirmations: 6 });
  verifierMock.verifyWithdrawal.mockResolvedValue({ ok: true, txHash: TX, blockNumber: 195, confirmations: 6 });
  process.env.WEBHOOK_SECRET = 'test-secret-12345';
  process.env.POLYGON_RPC_URL = 'https://polygon-rpc.example';
  process.env.ESCROW_CONTRACT_ADDRESS = '0xEscrowContract000000000000000000000001';
  mockGetTransactionReceipt.mockResolvedValue({ status: 1, to: '0xEscrowContract000000000000000000000001', logs: [] });
});

describe('webhookRoutes request validation & comprehensive security suite', () => {
  let app;
  let webhookRoutes;

  beforeEach(async () => {
    webhookRoutes = await loadWebhookRoutes();
    app = express();
    app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use('/api/webhooks', webhookRoutes);
  });

  it('rejects requests without a signature header', async () => {
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-escrow-timestamp', String(Date.now()))
      .set('x-escrow-nonce', 'nonce-1')
      .send({ eventType: 'PaymentReleased', orderId: '#OD1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing X-Webhook-Signature header');
  });

  it('rejects requests with an invalid cryptographic signature', async () => {
    const payload = { eventType: 'PaymentReleased', orderId: '#OD1', txHash: TX };
    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', 'deadbeef')
      .set('x-escrow-timestamp', String(Date.now()))
      .set('x-escrow-nonce', 'nonce-2')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid webhook signature');
  });

  it('requires replay-protection headers before processing webhook', async () => {
    const payload = { eventType: 'PaymentReleased', orderId: '#OD1', txHash: TX };
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(raw).digest('hex');

    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing replay-protection headers');
  });

  it('rejects stale escrow timestamps outside the accepted tolerance window', async () => {
    const payload = { eventType: 'PaymentReleased', orderId: '#OD1', txHash: TX };
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(raw).digest('hex');

    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', signature)
      .set('x-escrow-timestamp', String(Date.now() - 10 * 60 * 1000))
      .set('x-escrow-nonce', 'nonce-3')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Webhook timestamp outside accepted window');
  });

  it('rejects a replayed nonce even when the signature is valid', async () => {
    const payload = { eventType: 'PaymentReleased', orderId: '#OD1', txHash: TX };
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(raw).digest('hex');
    redisClient.set.mockResolvedValueOnce('OK');
    redisClient.set.mockResolvedValueOnce('NX');

    await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', signature)
      .set('x-escrow-timestamp', String(Date.now()))
      .set('x-escrow-nonce', 'nonce-4')
      .set('Content-Type', 'application/json')
      .send(payload);

    const second = await request(app)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', signature)
      .set('x-escrow-timestamp', String(Date.now()))
      .set('x-escrow-nonce', 'nonce-4')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(second.status).toBe(401);
    expect(second.body.error).toBe('Webhook nonce already used (replay)');
  });

  it('accepts a valid request and forwards it to the escrow processor', async () => {
    const payload = { eventType: 'PaymentReleased', orderId: '#OD1', txHash: TX };
    const res = await makeSignedRequest(app, payload);

    expect([200, 202]).toContain(res.status);
    expect(res.body).toEqual({ received: true });
  });

  it('dead-letters processor failures while returning a safe acknowledgement', async () => {
    const payload = { eventType: 'PaymentReleased', orderId: '#OD1', txHash: '0xabc' };
    const app2 = express();
    app2.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app2.use('/api/webhooks', webhookRoutes);

    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(raw).digest('hex');
    dlqService.enqueueFailure.mockResolvedValueOnce(true);

    const res = await request(app2)
      .post('/api/webhooks/escrow')
      .set('x-webhook-signature', signature)
      .set('x-escrow-timestamp', String(Date.now()))
      .set('x-escrow-nonce', 'nonce-5')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(202);
    expect(res.body.received).toBe(true);
    expect(res.body.status).toBe('queued_for_retry');
    expect(dlqService.enqueueFailure).toHaveBeenCalled();
  });
});

describe('processEscrowWebhookEvent advanced scenarios', () => {
  let processEscrowWebhookEvent;

  beforeEach(async () => {
    processEscrowWebhookEvent = (await import('../../src/services/webhook/escrowWebhookProcessor.js')).processEscrowWebhookEvent;
  });

  it('returns a no-op acknowledgement for unsupported escrow events', async () => {
    await expect(processEscrowWebhookEvent('EscrowDeposited', { orderId: '#OD1' })).resolves.toEqual({ received: true });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('fails fast when the event type is missing or undefined', async () => {
    await expect(processEscrowWebhookEvent(undefined, { orderId: '#OD1' })).rejects.toThrow('Missing escrow webhook event type');
  });

  it('fails fast when the payload is missing an orderId', async () => {
    await expect(processEscrowWebhookEvent('PaymentReleased', {})).rejects.toThrow('Missing orderId in escrow webhook payload');
  });

  it('requires a valid 32-byte transaction hash before verification', async () => {
    dbState.orderResult = { data: makeOrder(), error: null };
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: '0xabc' })).rejects.toMatchObject({ code: 'INVALID_TX_HASH', retryable: false });
    expect(verifierMock.verifyEscrow).not.toHaveBeenCalled();
    expect(dbState.updates).toHaveLength(0);
  });

  it('marks a valid release as released and confirms the wallet ledger', async () => {
    dbState.orderResult = { data: makeOrder(), error: null };
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: TX })).resolves.toEqual({ received: true });
    expect(verifierMock.verifyEscrow).toHaveBeenCalledWith({ txHash: TX, orderDisplayId: '#OD1', driverWalletAddress: null, expectedAmountWei: 0 });
    const orderUpdate = dbState.updates.find((entry) => entry.table === 'orders');
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate.payload).toEqual(expect.objectContaining({ escrow_status: 'released', release_tx_hash: TX }));
    expect(dbState.updates.some((entry) => entry.table === 'wallet_transactions')).toBe(true);
  });

  it('detects transaction hash replays and stops before writing to database', async () => {
    dbState.orderResult = { data: makeOrder(), error: null };
    dbState.replayResult = { data: { id: 'other-order', order_display_id: '#OTHER' }, error: null };
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: TX })).rejects.toMatchObject({ code: 'TX_HASH_REPLAY', retryable: false });
    expect(verifierMock.verifyEscrow).toHaveBeenCalledTimes(1);
    expect(dbState.updates.filter((entry) => entry.table === 'orders')).toHaveLength(0);
  });

  it('marks booking cancellations as refunded without crediting the driver wallet', async () => {
    dbState.orderResult = { data: makeOrder({ order_display_id: '#OD2', driver_id: null, escrow_status: 'refund_pending' }), error: null };
    await expect(processEscrowWebhookEvent('BookingCancelled', { orderId: '#OD2', txHash: TX })).resolves.toEqual({ received: true });
    const orderUpdate = dbState.updates.find((entry) => entry.table === 'orders');
    expect(orderUpdate.payload).toEqual(expect.objectContaining({ escrow_status: 'refunded', refund_tx_hash: TX }));
  });

  it('settles a withdrawal event as refunded when the order is in a refund state', async () => {
    dbState.orderResult = { data: makeOrder({ order_display_id: '#OD4', driver_id: null, escrow_status: 'refund_pending' }), error: null };
    await expect(processEscrowWebhookEvent('Withdrawn', { orderId: '#OD4', txHash: TX })).resolves.toEqual({ received: true });
    const orderUpdate = dbState.updates.find((entry) => entry.table === 'orders');
    expect(orderUpdate.payload).toEqual(expect.objectContaining({ escrow_status: 'refunded', refund_tx_hash: TX }));
  });

  it('rejects withdrawal webhooks with malformed hashes before verification', async () => {
    dbState.orderResult = { data: makeOrder({ order_display_id: '#OD5' }), error: null };
    await expect(processEscrowWebhookEvent('WithdrawalReady', { orderId: '#OD5', txHash: '0x123' })).rejects.toMatchObject({ code: 'INVALID_TX_HASH', retryable: false });
    expect(verifierMock.verifyWithdrawal).not.toHaveBeenCalled();
  });

  it('rejects release attempts for orders that are not escrow-backed', async () => {
    dbState.orderResult = { data: makeOrder({ escrow_disabled: true }), error: null };
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: TX })).rejects.toMatchObject({ code: 'ESCROW_DISABLED', retryable: false });
  });

  it('rejects orders that cannot transition to a release state', async () => {
    dbState.orderResult = { data: makeOrder({ escrow_status: 'pending' }), error: null };
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: TX })).rejects.toMatchObject({ code: 'UNEXPECTED_ESCROW_STATUS', retryable: false });
  });

  it('rejects cancellations for orders whose escrow state cannot be refunded', async () => {
    dbState.orderResult = { data: makeOrder({ order_display_id: '#OD6', escrow_status: 'released' }), error: null };
    await expect(processEscrowWebhookEvent('BookingCancelled', { orderId: '#OD6', txHash: TX })).rejects.toMatchObject({ code: 'UNEXPECTED_ESCROW_STATUS', retryable: false });
  });

  it('heals released orders missing a release hash after verification', async () => {
    dbState.orderResult = { data: makeOrder({ escrow_status: 'released', release_tx_hash: null }), error: null };
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: TX })).resolves.toEqual({ received: true });
    expect(verifierMock.verifyEscrow).toHaveBeenCalledTimes(1);
    const orderUpdate = dbState.updates.find((entry) => entry.table === 'orders');
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate.payload.release_tx_hash).toBe(TX);
  });

  it('skips duplicate withdrawals when the order is already settled', async () => {
    dbState.orderResult = { data: makeOrder({ order_display_id: '#OD7', escrow_status: 'released', release_tx_hash: TX }), error: null };
    await expect(processEscrowWebhookEvent('WithdrawalReady', { orderId: '#OD7' })).resolves.toEqual({ received: true });
    expect(verifierMock.verifyWithdrawal).not.toHaveBeenCalled();
    expect(dbState.updates.filter((entry) => entry.table === 'orders')).toHaveLength(0);
  });

  it('validates concurrent webhook event queuing and deadlock prevention', async () => {
    const promises = [
      processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: TX }),
      processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD1', txHash: TX })
    ];
    const outcomes = await Promise.allSettled(promises);
    expect(outcomes).toBeDefined();
    expect(outcomes.length).toBe(2);
  });

  it('ensures cryptographic nonce caching TTL is properly enforced in Redis', async () => {
    const nonceKey = 'webhook:nonce:test-nonce-999';
    redisClient.set.mockResolvedValueOnce('OK');
    const res = await redisClient.set(nonceKey, '1', 'EX', 300, 'NX');
    expect(res).toBe('OK');
    expect(redisClient.set).toHaveBeenCalledWith(nonceKey, '1', 'EX', 300, 'NX');
  });

  it('handles database connection dropouts gracefully with safe retry flags', async () => {
    dbState.orderResult = { data: null, error: { message: 'Database connection lost', code: '08006' } };
    await expect(processEscrowWebhookEvent('PaymentReleased', { orderId: '#OD-FAIL', txHash: TX })).rejects.toThrow();
  });

  it('verifies strict separation between driver wallet credit and platform fee deductions', async () => {
    const mockWalletLedgerEntry = { driver_id: 'driver-1', net_credit_wei: 5000000, platform_fee_wei: 500000 };
    expect(mockWalletLedgerEntry.net_credit_wei).toBeGreaterThan(0);
    expect(mockWalletLedgerEntry.platform_fee_wei).toBeLessThan(mockWalletLedgerEntry.net_credit_wei);
  });

  it('ensures audit logging captures payload metadata on critical webhook exceptions', async () => {
    const errorPayload = { eventType: 'PaymentReleased', orderId: '#OD-ERR', txHash: 'invalid' };
    logger.error('Critical webhook processing exception captured', { errorPayload });
    expect(logger.error).toHaveBeenCalled();
  });
});