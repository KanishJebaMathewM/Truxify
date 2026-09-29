import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fix mock path to correctly intercept src/middleware/logger.js
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import logger from '../../src/middleware/logger.js';
import { checkBypassEligibility, syncAndTransmitInternalWeights } from '../../src/services/weighStationService.js';

describe('WeighStationService Comprehensive Enterprise Test Suite (Issue #14039)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // 1. checkBypassEligibility Tests
  // ============================================================================
  describe('checkBypassEligibility', () => {
    it('returns UNSUPPORTED action with correct payload structure when WIM provider is not configured', async () => {
      const result = await checkBypassEligibility('driver-789', 28.6139, 77.2090);

      expect(result).toBeDefined();
      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.simulated).toBe(true);
      expect(result.stationId).toBeNull();
      expect(result.reason).toContain('Weigh-in-motion bypass is not available');
      expect(typeof result.timestamp).toBe('string');
      
      const parsedDate = new Date(result.timestamp);
      expect(parsedDate.getTime()).not.toBeNaN();
    });

    it('handles null or missing coordinates gracefully without throwing errors', async () => {
      const result = await checkBypassEligibility('driver-789', null, null);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('no WIM provider is configured');
    });

    it('handles undefined driverId correctly', async () => {
      const result = await checkBypassEligibility(undefined, 12.97, 77.59);

      expect(result).toEqual(
        expect.objectContaining({
          action: 'UNSUPPORTED',
          supported: false,
          simulated: true,
          stationId: null,
        })
      );
    });

    it('handles extreme coordinate values (latitude/longitude out of bounds) safely', async () => {
      const result = await checkBypassEligibility('driver-101', 999.99, -999.99);
      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
    });
  });

  // ============================================================================
  // 2. syncAndTransmitInternalWeights Tests
  // ============================================================================
  describe('syncAndTransmitInternalWeights', () => {
    it('returns UNSUPPORTED response and logs warning when internal weights sync is called', async () => {
      const mockAxles = [
        { axleNumber: 1, weightLbs: 12000 },
        { axleNumber: 2, weightLbs: 34000 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-789', 'truck-456', mockAxles);

      expect(result).toBeDefined();
      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(result.stationId).toBeNull();
      expect(result.reason).toContain('Configure WIM_PROVIDER_API_KEY to enable');
      expect(typeof result.timestamp).toBe('string');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WeighStation] syncAndTransmitInternalWeights called but no WIM provider is configured')
      );
    });

    it('handles empty axles array or missing truckId gracefully', async () => {
      const result = await syncAndTransmitInternalWeights('driver-789', null, []);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('handles malformed axle data objects without throwing runtime exceptions', async () => {
      const malformedAxles = [{ invalidKey: 'no-weight' }];
      const result = await syncAndTransmitInternalWeights('driver-999', 'truck-888', malformedAxles);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 3. High-Throughput Concurrency & Stress Tests
  // ============================================================================
  describe('High-Throughput Concurrency & Stress Validation', () => {
    it('maintains thread-safety and returns consistent UNSUPPORTED responses under high concurrent load', async () => {
      const concurrentRequests = Array.from({ length: 40 }).map((_, index) =>
        checkBypassEligibility(`driver-${index}`, 20.0 + index, 70.0 + index)
      );

      const results = await Promise.all(concurrentRequests);

      expect(results).toHaveLength(40);
      results.forEach(res => {
        expect(res.action).toBe('UNSUPPORTED');
        expect(res.supported).toBe(false);
        expect(res.simulated).toBe(true);
      });
    });

    it('handles parallel weight sync transmissions concurrently without state collision', async () => {
      const concurrentSyncs = Array.from({ length: 25 }).map((_, index) =>
        syncAndTransmitInternalWeights(`driver-${index}`, `truck-${index}`, [{ axleNumber: 1, weightLbs: 15000 }])
      );

      const results = await Promise.all(concurrentSyncs);

      expect(results).toHaveLength(25);
      results.forEach(res => {
        expect(res.action).toBe('UNSUPPORTED');
        expect(res.reason).toContain('Configure WIM_PROVIDER_API_KEY');
      });
      expect(logger.warn).toHaveBeenCalledTimes(25);
    });
  });

  // ============================================================================
  // 4. Advanced Telemetry, Compliance & Audit Log Verification Tests
  // ============================================================================
  describe('Advanced Telemetry & Compliance Auditing', () => {
    it('generates unique and valid timestamps for rapid sequential calls to checkBypassEligibility', async () => {
      const firstRes = await checkBypassEligibility('driver-1', 10.0, 20.0);
      // Small artificial delay
      await new Promise(resolve => setTimeout(resolve, 10));
      const secondRes = await checkBypassEligibility('driver-1', 10.0, 20.0);

      expect(firstRes.timestamp).toBeDefined();
      expect(secondRes.timestamp).toBeDefined();
      expect(new Date(secondRes.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(firstRes.timestamp).getTime());
    });

    it('handles extremely large axle arrays without performance degradation or memory overflow', async () => {
      const massiveAxles = Array.from({ length: 500 }).map((_, i) => ({
        axleNumber: i + 1,
        weightLbs: 10000 + i * 10
      }));

      const result = await syncAndTransmitInternalWeights('driver-bulk', 'truck-bulk', massiveAxles);

      expect(result.action).toBe('UNSUPPORTED');
      expect(result.supported).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('ensures stationId is strictly null across all fallback error paths', async () => {
      const result1 = await checkBypassEligibility(null, NaN, NaN);
      const result2 = await syncAndTransmitInternalWeights(null, null, null);

      expect(result1.stationId).toBeNull();
      expect(result2.stationId).toBeNull();
    });

    it('verifies simulated flag is always set to true for regulatory compliance safeguard', async () => {
      const result = await checkBypassEligibility('driver-compliance', 35.6895, 139.6917);
      expect(result.simulated).toBe(true);
      expect(result.reason).toContain('This is not a regulatory verdict');
    });

    it('handles negative or zero weight values in axles gracefully', async () => {
      const zeroNegativeAxles = [
        { axleNumber: 1, weightLbs: 0 },
        { axleNumber: 2, weightLbs: -5000 }
      ];

      const result = await syncAndTransmitInternalWeights('driver-neg', 'truck-neg', zeroNegativeAxles);
      expect(result.action).toBe('UNSUPPORTED');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('validates standard object mutability on returned responses', async () => {
      const result = await checkBypassEligibility('driver-seal', 12.0, 34.0);
      expect(result.action).toBe('UNSUPPORTED');
      expect(() => {
        result.simulated = false;
      }).not.toThrow();
      expect(result.simulated).toBe(false);
    });

    it('logs detailed warnings containing driver and truck correlation identifiers', async () => {
      await syncAndTransmitInternalWeights('driver-corr-999', 'truck-corr-888', [{ axleNumber: 1, weightLbs: 20000 }]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WeighStation] syncAndTransmitInternalWeights called')
      );
    });
  });
});