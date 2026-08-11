/**
 * Unit tests for backend/api/src/services/security/anomalyDetectionService.js
 *
 * Run with:  npm run test:unit -- test/unit/anomalyDetectionService.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

function makeQueryMock(result) {
  const thenable = {
    select: vi.fn(() => thenable),
    eq: vi.fn(() => thenable),
    gte: vi.fn(() => thenable),
    order: vi.fn(() => thenable),
    limit: vi.fn(() => thenable),
  };
  thenable.then = (resolve) => Promise.resolve(result).then(resolve);
  return thenable;
}

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: { from: vi.fn() },
}));

import AnomalyDetectionService, { ANOMALY_THRESHOLDS, ANOMALY_SEVERITY } from '../../src/services/security/anomalyDetectionService.js';
import { supabase, supabaseAdmin } from '../../src/config/db.js';

describe('AnomalyDetectionService', () => {
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnomalyDetectionService();
  });

  describe('detectUnusualTime', () => {
    it('returns null for transactions during normal hours (10am UTC)', () => {
      const transaction = { timestamp: new Date('2026-08-03T10:30:00Z').toISOString() };
      const anomaly = service.detectUnusualTime(transaction);
      expect(anomaly).toBeNull();
    });

    it('returns anomaly object for transactions at 3am UTC (unusual hours 0-6)', () => {
      const transaction = { timestamp: new Date('2026-08-03T03:00:00Z').toISOString() };
      const anomaly = service.detectUnusualTime(transaction);
      expect(anomaly).not.toBeNull();
      expect(anomaly.type).toBe('UNUSUAL_TIME');
      expect(anomaly.severity).toBe('LOW');
    });

    it('returns anomaly object for transactions at midnight (0:00 UTC)', () => {
      const transaction = { timestamp: new Date('2026-08-03T00:00:00Z').toISOString() };
      const anomaly = service.detectUnusualTime(transaction);
      expect(anomaly).not.toBeNull();
      expect(anomaly.type).toBe('UNUSUAL_TIME');
    });

    it('returns null for transactions at 7am UTC (just after unusual window)', () => {
      const transaction = { timestamp: new Date('2026-08-03T07:00:00Z').toISOString() };
      const anomaly = service.detectUnusualTime(transaction);
      expect(anomaly).toBeNull();
    });

    it('flags a transaction whose UTC hour is inside the unusual window', () => {
      const result = service.detectUnusualTime({ timestamp: '2026-08-04T01:30:00.000Z' });
      expect(result).not.toBeNull();
      expect(result.type).toBe('UNUSUAL_TIME');
      expect(result.message).toContain('1:00 UTC');
    });

    it('does not flag a late-evening UTC transaction even when it is a local morning hour', () => {
      const result = service.detectUnusualTime({ timestamp: '2026-08-04T23:30:00.000Z' });
      expect(result).toBeNull();
    });
  });

  describe('calculateRiskLevel', () => {
    it('returns LOW when there are no anomalies', () => {
      expect(service.calculateRiskLevel([])).toBe(ANOMALY_SEVERITY.LOW);
    });

    it('returns LOW when all anomalies are LOW severity', () => {
      expect(service.calculateRiskLevel([{ type: 'UNUSUAL_TIME', severity: 'LOW' }])).toBe(ANOMALY_SEVERITY.LOW);
    });

    it('returns MEDIUM when there is a MEDIUM severity anomaly', () => {
      expect(service.calculateRiskLevel([{ type: 'LARGE_WITHDRAWAL', severity: 'MEDIUM' }])).toBe(ANOMALY_SEVERITY.MEDIUM);
    });

    it('returns HIGH when there is a HIGH severity anomaly', () => {
      expect(service.calculateRiskLevel([{ type: 'SUSPICIOUS_PATTERN', severity: 'HIGH' }])).toBe(ANOMALY_SEVERITY.HIGH);
    });

    it('returns CRITICAL when there is a CRITICAL severity anomaly', () => {
      expect(service.calculateRiskLevel([{ type: 'CRITICAL_ALERT', severity: 'CRITICAL' }])).toBe(ANOMALY_SEVERITY.CRITICAL);
    });

    it('returns the maximum severity when anomalies have mixed severities', () => {
      const anomalies = [
        { type: 'UNUSUAL_TIME', severity: 'LOW' },
        { type: 'LARGE_WITHDRAWAL', severity: 'HIGH' },
        { type: 'CRITICAL_ALERT', severity: 'CRITICAL' },
      ];
      expect(service.calculateRiskLevel(anomalies)).toBe(ANOMALY_SEVERITY.CRITICAL);
    });
  });

  describe('shouldBlockTransaction', () => {
    it('returns false when there are no anomalies', () => {
      expect(service.shouldBlockTransaction([])).toBe(false);
    });

    it('returns false for LOW and MEDIUM severity anomalies', () => {
      expect(service.shouldBlockTransaction([{ type: 'UNUSUAL_TIME', severity: 'LOW' }])).toBe(false);
      expect(service.shouldBlockTransaction([{ type: 'UNUSUAL_TIME', severity: 'MEDIUM' }])).toBe(false);
    });

    it('returns true when there is a LARGE_WITHDRAWAL anomaly type', () => {
      expect(service.shouldBlockTransaction([{ type: 'LARGE_WITHDRAWAL', severity: 'LOW' }])).toBe(true);
    });

    it('returns true when there is a HIGH severity anomaly', () => {
      expect(service.shouldBlockTransaction([{ type: 'SUSPICIOUS_PATTERN', severity: 'HIGH' }])).toBe(true);
    });

    it('returns true when there is a CRITICAL severity anomaly', () => {
      expect(service.shouldBlockTransaction([{ type: 'CRITICAL_ALERT', severity: 'CRITICAL' }])).toBe(true);
    });
  });

  describe('detectLargeWithdrawal', () => {
    it('never scores a deposit/credit transaction as LARGE_WITHDRAWAL', async () => {
      const transaction = { type: 'deposit', amount: 50000 };
      expect(await service.detectLargeWithdrawal('user-1', 'wallet-1', transaction)).toBeNull();
    });

    it('never scores a credit/refund transaction as LARGE_WITHDRAWAL', async () => {
      const transaction = { type: 'credit', amount: 50000 };
      expect(await service.detectLargeWithdrawal('user-1', 'wallet-1', transaction)).toBeNull();
    });
  });

  describe('getUserAverageWithdrawal', () => {
    it('averages the recent bounded window ordered by recency', async () => {
      const queryMock = makeQueryMock({ data: [{ amount: '1000' }, { amount: '2000' }], error: null });
      supabaseAdmin.from.mockReturnValue(queryMock);

      const avg = await service.getUserAverageWithdrawal('user-1', 'wallet-1');

      expect(avg).toBe(1500);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('wallet_transactions');
      expect(queryMock.select).toHaveBeenCalledWith('amount');
      expect(queryMock.eq).toHaveBeenCalledWith('driver_id', 'user-1');
      expect(queryMock.eq).toHaveBeenCalledWith('txn_type', 'withdrawal');
      expect(queryMock.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(queryMock.limit).toHaveBeenCalledWith(1000);
    });

    it('falls back to half the LARGE_WITHDRAWAL threshold when the window is empty', async () => {
      supabaseAdmin.from.mockReturnValue(makeQueryMock({ data: [], error: null }));

      const avg = await service.getUserAverageWithdrawal('user-1', 'wallet-1');

      expect(avg).toBe(ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 2);
    });
  });

  describe('getUserWithdrawalStdDev', () => {
    it('computes the population standard deviation from the bounded window', async () => {
      // Amounts [100, 200, 300], mean = 200.
      // Population variance = ((100-200)^2 + (200-200)^2 + (300-200)^2) / 3 = 20000/3.
      // Population std-dev = sqrt(20000/3) ≈ 81.65.
      const queryMock = makeQueryMock({ data: [{ amount: '100' }, { amount: '200' }, { amount: '300' }], error: null });
      supabaseAdmin.from.mockReturnValue(queryMock);

      const stdDev = await service.getUserWithdrawalStdDev('user-1', 'wallet-1');

      expect(stdDev).toBeCloseTo(81.6497, 3);
      expect(queryMock.limit).toHaveBeenCalledWith(1000);
    });

    it('falls back to a quarter of the LARGE_WITHDRAWAL threshold with fewer than two rows', async () => {
      supabaseAdmin.from.mockReturnValue(makeQueryMock({ data: [{ amount: '100' }], error: null }));

      const stdDev = await service.getUserWithdrawalStdDev('user-1', 'wallet-1');

      expect(stdDev).toBe(ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL / 4);
    });
  });

  describe('detectMultipleTransfers', () => {
    it('flags transfers at or above the MULTIPLE_TRANSFERS threshold using exact count', async () => {
      // MULTIPLE_TRANSFERS threshold is 5. count=7 >= 5 -> anomaly.
      const queryMock = makeQueryMock({ count: 7, error: null });
      supabaseAdmin.from.mockReturnValue(queryMock);

      const result = await service.detectMultipleTransfers('user-1', 'wallet-1', { amount: '1' });

      expect(queryMock.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
      expect(result).toEqual(expect.objectContaining({ type: 'MULTIPLE_TRANSFERS', count: 7, severity: 'MEDIUM' }));
    });

    it('returns null when the exact count is below the threshold', async () => {
      // count=3 < threshold(5) -> no anomaly.
      supabaseAdmin.from.mockReturnValue(makeQueryMock({ count: 3, error: null }));

      const result = await service.detectMultipleTransfers('user-1', 'wallet-1', { amount: '1' });

      expect(result).toBeNull();
    });
  });
});
