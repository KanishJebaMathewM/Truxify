import { describe, it, expect } from 'vitest';
import { verifyTrailerSealIntegrity } from '../../src/services/sealIntegrity.js';

describe('sealIntegrity', () => {
  describe('verifyTrailerSealIntegrity', () => {
    it('verifies a valid trailer seal at PICKUP stage with correct serial and audit proof', () => {
      const result = verifyTrailerSealIntegrity({
        ebolId: 'ebol-7788',
        expectedSerial: 'bolt-99420-a',
        sealImageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
        checkStage: 'PICKUP',
      });

      expect(result).toBeDefined();
      expect(result.ebolId).toBe('ebol-7788');
      expect(result.checkStage).toBe('PICKUP');
      expect(result.verificationPassed).toBe(true);
      expect(result.serialNumberAnalysis.expectedSerial).toBe('BOLT-99420-A');
      expect(result.serialNumberAnalysis.isMatch).toBe(true);
      expect(result.computerVisionMetrics.tamperDetected).toBe(false);
      expect(result.computerVisionMetrics.structuralDefectScore).toBeLessThanOrEqual(0.15);
      expect(result.imageProof.imageHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.imageProof.auditTrailHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies delivery handoff comparing against baseline image hash', () => {
      const baselineHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const result = verifyTrailerSealIntegrity({
        ebolId: 'ebol-8899',
        expectedSerial: 'seal-5544',
        sealImageBase64: 'base64sampledata',
        checkStage: 'DELIVERY',
        baselineHash,
      });

      expect(result.checkStage).toBe('DELIVERY');
      expect(result.verificationPassed).toBe(true);
      expect(typeof result.imageProof.verifiedAt).toBe('string');
    });

    it('handles whitespace and casing in expected serial gracefully', () => {
      const result = verifyTrailerSealIntegrity({
        ebolId: 'ebol-spaces',
        expectedSerial: '  nx-9982-b   ',
      });

      expect(result.serialNumberAnalysis.expectedSerial).toBe('NX-9982-B');
      expect(result.serialNumberAnalysis.detectedSerial).toBe('NX-9982-B');
      expect(result.serialNumberAnalysis.isMatch).toBe(true);
    });

    it('handles empty image input and defaults to DELIVERY stage', () => {
      const result = verifyTrailerSealIntegrity({
        ebolId: 'ebol-empty',
        expectedSerial: 'def-1',
      });

      expect(result.checkStage).toBe('DELIVERY');
      expect(result.imageProof.imageHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.verificationPassed).toBe(true);
    });
  });
});
