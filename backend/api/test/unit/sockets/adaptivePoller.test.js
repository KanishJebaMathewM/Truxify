import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateAdaptiveInterval, getQueueDepth } from '../../../src/sockets/adaptivePoller.js';

describe('Adaptive Mongo Polling (#6691)', () => {
  const BASE_INTERVAL = 1000; // 1 second
  const THRESHOLD = 100;

  describe('calculateAdaptiveInterval', () => {
    it('should return halved interval when queue depth exceeds threshold', () => {
      const queueDepth = 150; // Above threshold
      const result = calculateAdaptiveInterval(queueDepth, BASE_INTERVAL, THRESHOLD);
      expect(result).toBe(500); // 1000 / 2
    });

    it('should return doubled interval when queue depth is below threshold', () => {
      const queueDepth = 50; // Below threshold
      const result = calculateAdaptiveInterval(queueDepth, BASE_INTERVAL, THRESHOLD);
      expect(result).toBe(2000); // 1000 * 2
    });

    it('should return base interval multiplier cap when queue is empty', () => {
      const queueDepth = 0;
      const result = calculateAdaptiveInterval(queueDepth, BASE_INTERVAL, THRESHOLD);
      expect(result).toBe(2000);
    });

    it('should respect MIN_INTERVAL_MS floor under extreme load', () => {
      const queueDepth = 10000;
      const verySmallBase = 15; 
      const result = calculateAdaptiveInterval(queueDepth, verySmallBase, THRESHOLD);
      expect(result).toBeGreaterThanOrEqual(10); // MIN_INTERVAL_MS is 10
    });

    it('should handle exact threshold boundary correctly', () => {
      // At exactly threshold, it should use the low-load backoff (multiplier)
      const resultExact = calculateAdaptiveInterval(THRESHOLD, BASE_INTERVAL, THRESHOLD);
      expect(resultExact).toBe(2000);

      // One above threshold triggers aggressive polling
      const resultAbove = calculateAdaptiveInterval(THRESHOLD + 1, BASE_INTERVAL, THRESHOLD);
      expect(resultAbove).toBe(500);
    });
  });

  describe('getQueueDepth', () => {
    it('should extract pendingWrites from metrics', () => {
      const mockBuffer = {
        getMetrics: vi.fn().mockReturnValue({ pendingWrites: 42, bufferSize: 10 })
      };
      expect(getQueueDepth(mockBuffer)).toBe(42);
    });

    it('should fallback to bufferSize if pendingWrites is missing', () => {
      const mockBuffer = {
        getMetrics: vi.fn().mockReturnValue({ bufferSize: 88 })
      };
      expect(getQueueDepth(mockBuffer)).toBe(88);
    });

    it('should return 0 if buffer is null or undefined', () => {
      expect(getQueueDepth(null)).toBe(0);
      expect(getQueueDepth(undefined)).toBe(0);
    });

    it('should return 0 if getMetrics throws an error', () => {
      const mockBuffer = {
        getMetrics: vi.fn().mockImplementation(() => { throw new Error('DB disconnected'); })
      };
      expect(getQueueDepth(mockBuffer)).toBe(0);
    });

    it('should return 0 if buffer lacks getMetrics function', () => {
      const mockBuffer = { bufferSize: 50 };
      expect(getQueueDepth(mockBuffer)).toBe(0);
    });
  });
});
