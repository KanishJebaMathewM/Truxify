import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

import BlockchainMetrics from '../../src/services/blockchain/blockchainMetrics.js';

describe('BlockchainMetrics', () => {
  let metrics;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.METRICS_COLLECTION_INTERVAL_MS = '60000';
    metrics = new BlockchainMetrics();
  });

  afterEach(() => {
    // Stop the collection timer
    if (metrics._timer) clearInterval(metrics._timer);
    metrics.metrics.paymentProcessingLatency = [];
  });

  describe('recordPaymentEvent', () => {
    it('raises success rate on success', () => {
      metrics.metrics.contractCallSuccessRate = 0;
      metrics.recordPaymentEvent('success');
      expect(metrics.metrics.contractCallSuccessRate).toBe(10);
    });

    it('decays success rate on failure', () => {
      metrics.metrics.contractCallSuccessRate = 100;
      metrics.recordPaymentEvent('failure');
      expect(metrics.metrics.contractCallSuccessRate).toBe(95);
    });
  });

  describe('recordPaymentLatency / getAveragePaymentLatency', () => {
    it('records latencies and computes the average', () => {
      metrics.recordPaymentLatency(100);
      metrics.recordPaymentLatency(200);
      expect(metrics.getAveragePaymentLatency()).toBe(150);
    });

    it('returns 0 with no latencies', () => {
      expect(metrics.getAveragePaymentLatency()).toBe(0);
    });

    it('caps the latency buffer at 1000 entries', () => {
      for (let i = 0; i < 1100; i += 1) {
        metrics.recordPaymentLatency(i);
      }
      expect(metrics.metrics.paymentProcessingLatency.length).toBe(1000);
    });
  });

  describe('recordDriverPayoutDelay', () => {
    it('averages with the existing value', () => {
      metrics.metrics.driverPayoutDelayAverage = 10;
      metrics.recordDriverPayoutDelay(20);
      expect(metrics.metrics.driverPayoutDelayAverage).toBe(15);
    });
  });

  describe('record counters', () => {
    it('increments failed transaction count', () => {
      metrics.recordFailedTransaction();
      metrics.recordFailedTransaction();
      expect(metrics.metrics.failedTransactionCount).toBe(2);
    });

    it('increments block scan count', () => {
      metrics.recordBlockScan(5);
      metrics.recordBlockScan(3);
      expect(metrics.metrics.blocksScanedPerDay).toBe(8);
    });

    it('increments geofence breach count', () => {
      metrics.recordGeofenceBreach();
      expect(metrics.metrics.geofenceBreachCount).toBe(1);
    });

    it('increments insurance event count', () => {
      metrics.recordInsuranceEvent('approved');
      expect(metrics.metrics.insuranceEventsCount).toBe(1);
    });
  });

  describe('getMetrics', () => {
    it('includes the average latency', () => {
      metrics.recordPaymentLatency(50);
      const snapshot = metrics.getMetrics();
      expect(snapshot.paymentProcessingLatencyAvg).toBe(50);
    });
  });
});
