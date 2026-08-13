import { describe, it, expect } from 'vitest';
import {
  TRACKING_TOKEN_STATUS_MESSAGES,
  trackingTokenInvalidResponse,
} from '../../src/utils/trackingTokenStatus.js';

describe('trackingTokenStatus', () => {
  describe('TRACKING_TOKEN_STATUS_MESSAGES', () => {
    it('is a defined object', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES).toBeDefined();
      expect(typeof TRACKING_TOKEN_STATUS_MESSAGES).toBe('object');
    });

    it('is not null', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES).not.toBeNull();
    });
  });

  describe('trackingTokenInvalidResponse', () => {
    it('is a function', () => {
      expect(typeof trackingTokenInvalidResponse).toBe('function');
    });

    it('returns an object with error shape', () => {
      const result = trackingTokenInvalidResponse({ field: 'token', message: 'invalid' });
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });
});
