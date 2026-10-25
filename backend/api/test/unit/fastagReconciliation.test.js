import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  verifyFastagWebhookSignature,
  processFastagTransaction,
  reconcileOrderTolls,
} from '../../src/services/fastagReconciliationService.js';
import { DomainError } from '../../src/services/order/domainError.js';

const WEBHOOK_SECRET = process.env.FASTAG_WEBHOOK_SECRET || 'truxify-fastag-webhook-secret-2026';

const sign = (payload) =>
  crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');

let seq = 0;
const nextId = (prefix) => `${prefix}_${Date.now()}_${(seq += 1)}`;

// Regression for #17786: verifyFastagWebhookSignature fed unequal-length
// buffers straight into crypto.timingSafeEqual, so any signature header whose
// length differed from the 64-char SHA-256 hex digest threw an unhandled
// RangeError (HTTP 500) instead of returning false (HTTP 401).
describe('verifyFastagWebhookSignature (#17786)', () => {
  const payload = JSON.stringify({ transactionId: 'TXN_1' });

  it('accepts a correctly signed payload', () => {
    expect(verifyFastagWebhookSignature(payload, sign(payload))).toBe(true);
  });

  it('returns false for a wrong but same-length signature', () => {
    expect(verifyFastagWebhookSignature(payload, 'a'.repeat(64))).toBe(false);
  });

  it('returns false instead of throwing on a truncated signature', () => {
    expect(() => verifyFastagWebhookSignature(payload, 'deadbeef')).not.toThrow();
    expect(verifyFastagWebhookSignature(payload, 'deadbeef')).toBe(false);
  });

  it('returns false instead of throwing on an over-long signature', () => {
    const long = 'f'.repeat(200);
    expect(() => verifyFastagWebhookSignature(payload, long)).not.toThrow();
    expect(verifyFastagWebhookSignature(payload, long)).toBe(false);
  });

  it('returns false for empty, non-string and missing signatures', () => {
    expect(verifyFastagWebhookSignature(payload, '')).toBe(false);
    expect(verifyFastagWebhookSignature(payload, null)).toBe(false);
    expect(verifyFastagWebhookSignature(payload, undefined)).toBe(false);
    expect(verifyFastagWebhookSignature(payload, ['a'.repeat(64)])).toBe(false);
  });
});

// Regression for #17786: `amountInr <= 0` let 'abc' (NaN <= 0 is false) and
// Infinity through, permanently poisoning orderTollLedgers with NaN.
describe('processFastagTransaction amount validation (#17786)', () => {
  const expectRejected = async (amountInr) => {
    const txData = { transactionId: nextId('TXN'), amountInr };
    await expect(processFastagTransaction(txData, { orderId: nextId('ORD') })).rejects.toMatchObject({
      name: 'DomainError',
      status: 400,
    });
  };

  it.each(['abc', 'Infinity', -Infinity, NaN, 0, -10, '', true, null, {}, [], 0.001])(
    'rejects amountInr = %o with DomainError(400)',
    async (amountInr) => {
      await expectRejected(amountInr);
    }
  );

  it('accepts a numeric string and normalises it to 2 decimals', async () => {
    const result = await processFastagTransaction(
      { transactionId: nextId('TXN'), amountInr: '150.5' },
      { orderId: nextId('ORD') }
    );
    expect(result.reconciliation.amountInr).toBe(150.5);
  });

  it('does not poison the ledger when a non-numeric amount arrives', async () => {
    const orderId = nextId('ORD');
    const bad = { transactionId: nextId('TXN'), amountInr: 'abc' };
    await expect(processFastagTransaction(bad, { orderId })).rejects.toBeInstanceOf(DomainError);

    const good = { transactionId: nextId('TXN'), amountInr: 100 };
    await processFastagTransaction(good, { orderId });

    const report = await reconcileOrderTolls(orderId, 100);
    expect(Number.isFinite(report.actualTollsInr)).toBe(true);
    expect(report.actualTollsInr).toBe(100);
  });
});

// Regression for #17786: consecutive IEEE-754 additions drifted (0.1 * 3
// accumulated to 0.30000000000000004) with no paisa rounding.
describe('toll ledger rounding (#17786)', () => {
  it('accumulates repeated 0.1 additions to exactly 0.3', async () => {
    const orderId = nextId('ORD');

    for (let i = 0; i < 3; i += 1) {
      await processFastagTransaction(
        { transactionId: nextId('TXN'), amountInr: 0.1 },
        { orderId }
      );
    }

    const report = await reconcileOrderTolls(orderId, 0.3);
    expect(report.actualTollsInr).toBe(0.3);
    expect(report.varianceInr).toBe(0);
    expect(report.isWithinBudget).toBe(true);
    expect(report.totalTransactions).toBe(3);
  });

  it('rejects amounts carrying more than 2 decimal places', async () => {
    const orderId = nextId('ORD');
    await expect(
      processFastagTransaction(
        { transactionId: nextId('TXN'), amountInr: 33.335 },
        { orderId }
      )
    ).rejects.toMatchObject({ name: 'DomainError', status: 400 });

    const report = await reconcileOrderTolls(orderId, 10);
    expect(report.totalTransactions).toBe(0);
    expect(report.actualTollsInr).toBe(0);
  });

  it('keeps variance at 2-decimal precision', async () => {
    const orderId = nextId('ORD');
    await processFastagTransaction(
      { transactionId: nextId('TXN'), amountInr: 45.67 },
      { orderId }
    );

    const report = await reconcileOrderTolls(orderId, 30);
    expect(report.actualTollsInr).toBe(45.67);
    expect(report.varianceInr).toBe(15.67);
    expect(report.isWithinBudget).toBe(false);
  });
});
