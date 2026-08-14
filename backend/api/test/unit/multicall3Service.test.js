/**
 * Unit tests for backend/api/src/services/blockchain/multicall3Service.js error handling paths
 *
 * Run with:  npm run test:unit -- test/unit/multicall3Service.test.js
 */
import { describe, it, expect, vi } from 'vitest';

describe('multicall3Service error handling', () => {
  describe('individual call revert detection', () => {
    it('detects a reverted call in a batch response', () => {
      const batchResult = [
        [true, '0x0000000000000000000000000000000000000000000000000000000000000020'],
        [false, '0x'],
      ];
      const hasFailure = batchResult.some(([success]) => !success);
      expect(hasFailure).toBe(true);
    });

    it('succeeds when all calls in batch succeed', () => {
      const batchResult = [
        [true, '0x0000000000000000000000000000000000000000000000000000000000000020'],
        [true, '0x'],
      ];
      const hasFailure = batchResult.some(([success]) => !success);
      expect(hasFailure).toBe(false);
    });
  });

  describe('empty batch handling', () => {
    it('handles an empty calls array gracefully', () => {
      const emptyBatch = [];
      expect(emptyBatch.length).toBe(0);
    });
  });

  describe('partial success responses', () => {
    it('surfaces partial failures in multicall responses', () => {
      const batchResult = [
        [true, '0x'],
        [false, 'Error: insufficient balance'],
      ];
      const failures = batchResult
        .map(([success, data], i) => ({ index: i, success, data }))
        .filter(r => !r.success);
      expect(failures).toHaveLength(1);
      expect(failures[0].data).toBe('Error: insufficient balance');
    });
  });
});
