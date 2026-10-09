import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  verifyFastagWebhookSignature,
  processFastagTransaction,
  reconcileOrderTolls,
  getOrderTollTransactions,
  _resetState,
} from '../../src/services/fastagReconciliationService.js';
import { handleFastagWebhook } from '../../src/controllers/tollController.js';

describe('FASTag Reconciliation Service & Toll Controller', () => {
  const secret = process.env.FASTAG_WEBHOOK_SECRET || 'truxify-fastag-webhook-secret-2026';

  function generateValidSignature(payload) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(raw).digest('hex');
  }

  beforeEach(() => {
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
  });

  describe('processFastagTransaction', () => {
    it('processes and settles a valid transaction successfully', async () => {
      const txData = {
        transactionId: 'TX_SUCCESS_1',
        tagId: 'TAG_1234',
        vrn: 'MH12AB1234',
        tollPlazaId: 'PLAZA_CHENNAI_01',
        amountInr: 175.50,
      };

      const result = await processFastagTransaction(txData);
      expect(result.status).toBe('SETTLED');
      expect(result.reconciliation.transactionId).toBe('TX_SUCCESS_1');
      expect(result.reconciliation.amountInr).toBe(175.50);
      expect(result.reconciliation.settlementStatus).toBe('SETTLED');
    });

    it('enforces idempotency: ignores duplicate transactionId', async () => {
      const txData = {
        transactionId: 'TX_IDEMP_1',
        amountInr: 80,
      };

      const first = await processFastagTransaction(txData);
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

    it('rounds fractional amountInr to 2 decimal places (paisa precision)', async () => {
      const result = await processFastagTransaction({
        transactionId: 'TX_ROUND',
        amountInr: 125.456,
      });
      expect(result.reconciliation.amountInr).toBe(125.46);
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
        amountInr: 90,
      };
      const gpsContext = {
        currentLat: NaN,
        currentLng: 'bad-coord',
      };

      const result = await processFastagTransaction(txData, gpsContext);
      expect(result.status).toBe('SETTLED');
      expect(result.reconciliation.isGpsVerified).toBe(true); // falls back to telemetry lag default
    });
  });

  describe('Order Toll Ledger and reconcileOrderTolls', () => {
    it('accumulates multiple toll transactions for an order with exact floating point math', async () => {
      const orderId = 'ORD_MULTI_TOLL';

      await processFastagTransaction({ transactionId: 'TX_1', amountInr: 50.10 }, { orderId });
      await processFastagTransaction({ transactionId: 'TX_2', amountInr: 70.20 }, { orderId });
      await processFastagTransaction({ transactionId: 'TX_3', amountInr: 35.45 }, { orderId });

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

      await processFastagTransaction({ transactionId: 'TX_OVER_1', amountInr: 300 }, { orderId });

      const reconciliation = await reconcileOrderTolls(orderId, 250);
      expect(reconciliation.isWithinBudget).toBe(false);
      expect(reconciliation.varianceInr).toBe(50.00);
    });

    it('handles non-finite or negative estimated tolls safely', async () => {
      const orderId = 'ORD_SAFE_EST';
      await processFastagTransaction({ transactionId: 'TX_S1', amountInr: 100 }, { orderId });

      const resNaN = await reconcileOrderTolls(orderId, NaN);
      expect(resNaN.estimatedTollInr).toBe(0);

      const resNeg = await reconcileOrderTolls(orderId, -100);
      expect(resNeg.estimatedTollInr).toBe(0);
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
        error: 'Missing required FASTag webhook signature header',
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

      const payload = { transactionId: 'TX_PROD_3', amountInr: 150 };
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
