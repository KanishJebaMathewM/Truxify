/**
 * Unit tests for backend/api/src/services/security/anomalyDetectionService.js
 *
 * Coverage:
 *   - detectUnusualTime: normal hours (9-17), returns empty array
 *   - detectUnusualTime: very early morning (3am), returns anomaly
 *   - detectUnusualTime: late night (midnight), returns anomaly
 *   - calculateRiskLevel: no anomalies = LOW
 *   - calculateRiskLevel: severity LOW only = LOW
 *   - calculateRiskLevel: severity MEDIUM = MEDIUM
 *   - calculateRiskLevel: severity HIGH = HIGH
 *   - calculateRiskLevel: mixed severity = max severity
 *   - shouldBlockTransaction: LOW risk = false
 *   - shouldBlockTransaction: MEDIUM risk = false
 *   - shouldBlockTransaction: HIGH risk = true
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

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
}));

import AnomalyDetectionService, { ANOMALY_THRESHOLDS, ANOMALY_SEVERITY } from '../../src/services/security/anomalyDetectionService.js';

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
  });

  describe('calculateRiskLevel', () => {
    it('returns LOW when there are no anomalies', () => {
      const riskLevel = service.calculateRiskLevel([]);
      expect(riskLevel).toBe(ANOMALY_SEVERITY.LOW);
    });

    it('returns LOW when all anomalies are LOW severity', () => {
      const anomalies = [
        { type: 'UNUSUAL_TIME', severity: 'LOW' },
      ];
      const riskLevel = service.calculateRiskLevel(anomalies);
      expect(riskLevel).toBe(ANOMALY_SEVERITY.LOW);
    });

    it('returns MEDIUM when there is a MEDIUM severity anomaly', () => {
      const anomalies = [
        { type: 'UNUSUAL_TIME', severity: 'LOW' },
        { type: 'LARGE_WITHDRAWAL', severity: 'MEDIUM' },
      ];
      const riskLevel = service.calculateRiskLevel(anomalies);
      expect(riskLevel).toBe(ANOMALY_SEVERITY.MEDIUM);
    });

    it('returns HIGH when there is a HIGH severity anomaly', () => {
      const anomalies = [
        { type: 'UNUSUAL_TIME', severity: 'LOW' },
        { type: 'SUSPICIOUS_PATTERN', severity: 'HIGH' },
      ];
      const riskLevel = service.calculateRiskLevel(anomalies);
      expect(riskLevel).toBe(ANOMALY_SEVERITY.HIGH);
    });

    it('returns CRITICAL when there is a CRITICAL severity anomaly', () => {
      const anomalies = [
        { type: 'UNUSUAL_TIME', severity: 'LOW' },
        { type: 'CRITICAL_ALERT', severity: 'CRITICAL' },
      ];
      const riskLevel = service.calculateRiskLevel(anomalies);
      expect(riskLevel).toBe(ANOMALY_SEVERITY.CRITICAL);
    });
  });

  describe('shouldBlockTransaction', () => {
    it('returns false when there are no anomalies', () => {
      const result = service.shouldBlockTransaction([]);
      expect(result).toBe(false);
    });

    it('returns false for MEDIUM severity anomalies', () => {
      const anomalies = [{ type: 'UNUSUAL_TIME', severity: 'MEDIUM' }];
      const result = service.shouldBlockTransaction(anomalies);
      expect(result).toBe(false);
    });

    it('returns true when there is a LARGE_WITHDRAWAL anomaly type', () => {
      const anomalies = [{ type: 'LARGE_WITHDRAWAL', severity: 'LOW' }];
      const result = service.shouldBlockTransaction(anomalies);
      expect(result).toBe(true);
    });

    it('returns true when there is a CRITICAL severity anomaly', () => {
      const anomalies = [{ type: 'CRITICAL_ALERT', severity: 'CRITICAL' }];
      const result = service.shouldBlockTransaction(anomalies);
      expect(result).toBe(true);
    });
  });
});
