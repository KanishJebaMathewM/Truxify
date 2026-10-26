import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  verifyFastagWebhookSignature,
  processFastagTransaction,
  reconcileOrderTolls,
  getOrderTollTransactions,
  _resetState,
  _getStateSize,
  MAX_ORDER_TOLL_LEDGERS,
} from '../../src/services/fastagReconciliationService.js';
import { handleFastagWebhook } from '../../src/controllers/tollController.js';

describe('FASTag Reconciliation Service & Toll Controller', () => {
  const secret = 'test-fastag-webhook-secret-0123456789';
  const NEAR_MURTHAL = { currentLat: 29.0310, currentLng: 77.0725 };
  process.env.FASTAG_WEBHOOK_SECRET = secret;

  function generateValidSignature(payload) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(raw).digest('hex');
  }

  beforeEach(() => {
    process.env.FASTAG_WEBHOOK_SECRET = secret;
    _resetState();
  });

  describe('verifyFastagWebhookSignature', () => {
    it('returns true for a valid HMAC SHA-256 signature with object payload', () => {
      const payload = { transactionId: 'TX100', amountInr: 120 };
      const signature = generateValidSignature(payload);
      expect(verifyFastagWebhookSignature(payload, signature)).toBe(true);
    });

    it('returns true for a valid HMAC signature with string payload', () => {
      const payload = JSON.stringify({ transactionId: 'TX101', amountInr: 250 });
      const signature = generateValidSignature(payload);
      expect(verifyFastagWebhookSignature(payload, signature)).toBe(true);
    });

    it('returns false for an invalid signature of valid length (64 chars)', () => {
      const payload = { transactionId: 'TX102', amountInr: 300 };
      const wrongSignature = 'a'.repeat(64);
      expect(verifyFastagWebhookSignature(payload, wrongSignature)).toBe(false);
    });

    it('returns false without throwing RangeError when signature length is too short', () => {
      const payload = { transactionId: 'TX103', amountInr: 50 };
      expect(verifyFastagWebhookSignature(payload, 'short-sig')).toBe(false);
      expect(verifyFastagWebhookSignature(payload, '12345')).toBe(false);
      expect(verifyFastagWebhookSignature(payload, '')).toBe(false);
    });

    it('returns false without throwing RangeError when signature length is too long', () => {
      const payload = { transactionId: 'TX104', amountInr: 50 };
      expect(verifyFastagWebhookSignature(payload, 'a'.repeat(70))).toBe(false);
      expect(verifyFastagWebhookSignature(payload, '0'.repeat(128))).toBe(false);
    });

    it('returns false when signature contains non-hexadecimal characters', () => {
      const payload = { transactionId: 'TX105', amountInr: 50 };
      const nonHexSignature = 'g'.repeat(64);
      expect(verifyFastagWebhookSignature(payload, nonHexSignature)).toBe(false);
    });

    it('returns false when signatureHeader is missing, null, or not a string', () => {
      const payload = { transactionId: 'TX106', amountInr: 50 };
      expect(verifyFastagWebhookSignature(payload, null)).toBe(false);
      expect(verifyFastagWebhookSignature(payload, undefined)).toBe(false);
      expect(verifyFastagWebhookSignature(payload, 12345678)).toBe(false);
      expect(verifyFastagWebhookSignature(payload, {})).toBe(false);
    });

    it('returns false when the webhook secret is not configured', () => {
      const payload = { transactionId: 'TX107', amountInr: 50 };
      const saved = process.env.FASTAG_WEBHOOK_SECRET;
      delete process.env.FASTAG_WEBHOOK_SECRET;
      try {
        expect(verifyFastagWebhookSignature(payload, 'a'.repeat(64))).toBe(false);
      } finally {
        process.env.FASTAG_WEBHOOK_SECRET = saved;
      }
    });
  });

  describe('processFastagTransaction', () => {
    it('processes and settles a valid transaction successfully', async () => {
      const txData = {
        transactionId: 'TX_SUCCESS_1',
        tagId: 'TAG_1234',
        vrn: 'MH12AB1234',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 175.50,
      };

      const result = await processFastagTransaction(txData, { ...NEAR_MURTHAL });
      expect(result.status).toBe('SETTLED');
      expect(result.reconciliation.transactionId).toBe('TX_SUCCESS_1');
      expect(result.reconciliation.amountInr).toBe(175.50);
      expect(result.reconciliation.settlementStatus).toBe('SETTLED');
    });

    it('enforces idempotency: ignores duplicate transactionId', async () => {
      const txData = {
        transactionId: 'TX_IDEMP_1',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 80,
      };

      const first = await processFastagTransaction(txData, { ...NEAR_MURTHAL });
      expect(first.status).toBe('SETTLED');

      const duplicate = await processFastagTransaction(txData);
      expect(duplicate.status).toBe('DUPLICATE_IGNORED');
      expect(duplicate.message).toBe('Transaction has already been processed');
      expect(duplicate.transaction.transactionId).toBe('TX_IDEMP_1');
    });

    it('rejects missing or empty transactionId with DomainError 400', async () => {
      await expect(processFastagTransaction({ amountInr: 100 })).rejects.toThrow();
      await expect(processFastagTransaction({ transactionId: '', amountInr: 100 })).rejects.toThrow();
      await expect(processFastagTransaction({ transactionId: '   ', amountInr: 100 })).rejects.toThrow();
    });

    it('rejects non-numeric and non-finite amountInr (NaN, "abc", Infinity)', async () => {
      await expect(processFastagTransaction({ transactionId: 'TX_NAN_1', amountInr: 'invalid' })).rejects.toThrow();
      await expect(processFastagTransaction({ transactionId: 'TX_NAN_2', amountInr: NaN })).rejects.toThrow();
      await expect(processFastagTransaction({ transactionId: 'TX_INF_1', amountInr: Infinity })).rejects.toThrow();
      await expect(processFastagTransaction({ transactionId: 'TX_INF_2', amountInr: -Infinity })).rejects.toThrow();
    });

    it('rejects zero or negative amountInr', async () => {
      await expect(processFastagTransaction({ transactionId: 'TX_ZERO', amountInr: 0 })).rejects.toThrow();
      await expect(processFastagTransaction({ transactionId: 'TX_NEG', amountInr: -50 })).rejects.toThrow();
    });

    it('accepts amounts with at most 2 decimal places (paisa precision)', async () => {
      const result = await processFastagTransaction({
        transactionId: 'TX_ROUND',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 125.45,
      }, { ...NEAR_MURTHAL });
      expect(result.reconciliation.amountInr).toBe(125.45);
    });

    it('rejects amounts with sub-paisa precision instead of silently rounding them', async () => {
      await expect(processFastagTransaction({
        transactionId: 'TX_SUB_PAISA',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 125.456,
      }, { ...NEAR_MURTHAL })).rejects.toThrow('Invalid FASTag transaction payload');
    });

    it('verifies GPS proximity when coordinates are within toll plaza geofence', async () => {
      const txData = {
        transactionId: 'TX_GPS_NEAR',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 90,
      };
      // Coordinates close to Murthal (lat: 29.0305, lng: 77.0722)
      const gpsContext = {
        currentLat: 29.0310,
        currentLng: 77.0725,
        orderId: 'ORD_991',
        driverId: 'DRV_442',
      };

      const result = await processFastagTransaction(txData, gpsContext);
      expect(result.reconciliation.isGpsVerified).toBe(true);
      expect(result.reconciliation.orderId).toBe('ORD_991');
      expect(result.reconciliation.driverId).toBe('DRV_442');
      expect(result.reconciliation.distanceFromPlazaMeters).toBeLessThan(2000);
    });

    it('marks GPS unverified when truck is far from toll plaza', async () => {
      const txData = {
        transactionId: 'TX_GPS_FAR',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 90,
      };
      // Coordinates far away in Bangalore (12.9716, 77.5946)
      const gpsContext = {
        currentLat: 12.9716,
        currentLng: 77.5946,
      };

      const result = await processFastagTransaction(txData, gpsContext);
      expect(result.reconciliation.isGpsVerified).toBe(false);
      expect(result.reconciliation.distanceFromPlazaMeters).toBeGreaterThan(10000);
    });

    it('handles non-finite / invalid GPS coordinates gracefully without crashing', async () => {
      const txData = {
        transactionId: 'TX_GPS_INVALID',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 90,
      };
      const gpsContext = {
        currentLat: NaN,
        currentLng: 'bad-coord',
      };

      const result = await processFastagTransaction(txData, gpsContext);
      expect(result.status).toBe('PENDING_VERIFICATION');
      expect(result.reconciliation.isGpsVerified).toBe(false);
    });

    it('does not settle when the toll plaza is not in the registry', async () => {
      const result = await processFastagTransaction({
        transactionId: 'TX_UNKNOWN_PLAZA',
        tollPlazaId: 'NOT_A_REGISTERED_PLAZA',
        amountInr: 100,
      }, { ...NEAR_MURTHAL, orderId: 'ORD_UNKNOWN_PLAZA' });

      expect(result.status).toBe('PENDING_VERIFICATION');
      expect(result.reconciliation.isGpsVerified).toBe(false);
      expect(result.reconciliation.settlementStatus).toBe('PENDING_VERIFICATION');
      expect(getOrderTollTransactions('ORD_UNKNOWN_PLAZA')).toHaveLength(0);
    });

    it('does not settle when GPS telemetry is missing', async () => {
      const result = await processFastagTransaction({
        transactionId: 'TX_NO_GPS',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 100,
      }, { orderId: 'ORD_NO_GPS' });

      expect(result.status).toBe('PENDING_VERIFICATION');
      expect(result.reconciliation.isGpsVerified).toBe(false);
      expect(result.reconciliation.settledAt).toBeNull();
      expect(getOrderTollTransactions('ORD_NO_GPS')).toHaveLength(0);
    });
  });

  describe('Order Toll Ledger and reconcileOrderTolls', () => {
    it('accumulates multiple toll transactions for an order with exact floating point math', async () => {
      const orderId = 'ORD_MULTI_TOLL';

      await processFastagTransaction({ transactionId: 'TX_1', tollPlazaId: 'TP_NH44_MURTHAL', amountInr: 50.10 }, { ...NEAR_MURTHAL, orderId });
      await processFastagTransaction({ transactionId: 'TX_2', tollPlazaId: 'TP_NH44_MURTHAL', amountInr: 70.20 }, { ...NEAR_MURTHAL, orderId });
      await processFastagTransaction({ transactionId: 'TX_3', tollPlazaId: 'TP_NH44_MURTHAL', amountInr: 35.45 }, { ...NEAR_MURTHAL, orderId });

      const txs = getOrderTollTransactions(orderId);
      expect(txs).toHaveLength(3);

      const reconciliation = await reconcileOrderTolls(orderId, 200.00);
      expect(reconciliation.actualTollsInr).toBe(155.75);
      expect(reconciliation.estimatedTollInr).toBe(200.00);
      expect(reconciliation.varianceInr).toBe(-44.25);
      expect(reconciliation.isWithinBudget).toBe(true);
      expect(reconciliation.totalTransactions).toBe(3);
    });

    it('flags budget overrun when actual tolls exceed estimate', async () => {
      const orderId = 'ORD_OVERRUN';

      await processFastagTransaction({ transactionId: 'TX_OVER_1', tollPlazaId: 'TP_NH44_MURTHAL', amountInr: 300 }, { ...NEAR_MURTHAL, orderId });

      const reconciliation = await reconcileOrderTolls(orderId, 250);
      expect(reconciliation.isWithinBudget).toBe(false);
      expect(reconciliation.varianceInr).toBe(50.00);
    });

    it('handles non-finite or negative estimated tolls safely', async () => {
      const orderId = 'ORD_SAFE_EST';
      await processFastagTransaction({ transactionId: 'TX_S1', tollPlazaId: 'TP_NH44_MURTHAL', amountInr: 100 }, { ...NEAR_MURTHAL, orderId });

      const resNaN = await reconcileOrderTolls(orderId, NaN);
      expect(resNaN.estimatedTollInr).toBe(0);

      const resNeg = await reconcileOrderTolls(orderId, -100);
      expect(resNeg.estimatedTollInr).toBe(0);
    });

    it('bounds the number of order toll ledgers', async () => {
      for (let i = 0; i < MAX_ORDER_TOLL_LEDGERS + 5; i += 1) {
        await processFastagTransaction({
          transactionId: `TX_CAP_${i}`,
          tollPlazaId: 'TP_NH44_MURTHAL',
          amountInr: 1,
        }, { ...NEAR_MURTHAL, orderId: `ORD_CAP_${i}` });
      }

      expect(_getStateSize().orderTollLedgers).toBe(MAX_ORDER_TOLL_LEDGERS);
    });

    it('throws DomainError if orderId is missing', async () => {
      await expect(reconcileOrderTolls('')).rejects.toThrow();
      await expect(reconcileOrderTolls(null)).rejects.toThrow();
    });
  });

  describe('tollController.handleFastagWebhook', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('rejects with 401 when signature header is missing in production mode', async () => {
      process.env.NODE_ENV = 'production';

      const req = {
        headers: {},
        body: { transaction: { transactionId: 'TX_PROD_1', amountInr: 100 } },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await handleFastagWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: 'Missing FASTag webhook signature',
      }));
    });

    it('rejects with 401 when signature header is invalid in production mode', async () => {
      process.env.NODE_ENV = 'production';

      const req = {
        headers: { 'x-fastag-signature': 'invalid-sig' },
        body: { transaction: { transactionId: 'TX_PROD_2', amountInr: 100 } },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await handleFastagWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: 'Invalid FASTag webhook HMAC signature',
      }));
    });

    it('accepts and processes valid webhook signature in production mode', async () => {
      process.env.NODE_ENV = 'production';

      const payload = {
        transactionId: 'TX_PROD_3',
        tollPlazaId: 'TP_NH44_MURTHAL',
        amountInr: 150,
        gpsContext: { ...NEAR_MURTHAL },
      };
      const signature = generateValidSignature(payload);

      const req = {
        headers: { 'x-fastag-signature': signature },
        body: payload,
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await handleFastagWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'SETTLED' }),
      }));
    });

    it('accepts unsigned webhook in non-production development mode', async () => {
      process.env.NODE_ENV = 'development';

      const req = {
        headers: {},
        body: { transactionId: 'TX_DEV_1', amountInr: 60 },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await handleFastagWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
      }));
    });
  });
});
