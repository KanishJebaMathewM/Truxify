import { describe, it, expect } from 'vitest';
import {
  TRACKING_TOKEN_STATUS_MESSAGES,
  trackingTokenInvalidResponse,
} from '../../../src/utils/trackingTokenStatus.js';

describe('trackingTokenStatus.js', () => {
  describe('TRACKING_TOKEN_STATUS_MESSAGES', () => {
    it('has not_found mapping to 404', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES.not_found.status).toBe(404);
      expect(TRACKING_TOKEN_STATUS_MESSAGES.not_found.message).toBeTruthy();
    });

    it('has revoked mapping to 410', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES.revoked.status).toBe(410);
    });

    it('has expired mapping to 410', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES.expired.status).toBe(410);
    });
  });

  describe('trackingTokenInvalidResponse', () => {
    it('returns 404 for not_found reason', () => {
      const result = trackingTokenInvalidResponse({ reason: 'not_found' });
      expect(result.status).toBe(404);
    });

    it('returns 410 for revoked reason', () => {
      const result = trackingTokenInvalidResponse({ reason: 'revoked' });
      expect(result.status).toBe(410);
    });

    it('returns 410 for expired reason', () => {
      const result = trackingTokenInvalidResponse({ reason: 'expired' });
      expect(result.status).toBe(410);
    });

    it('falls back to 404 for unknown reason', () => {
      const result = trackingTokenInvalidResponse({ reason: 'unknown_reason' });
      expect(result.status).toBe(404);
    });

    it('falls back to 404 when no reason is provided', () => {
      const result = trackingTokenInvalidResponse({});
      expect(result.status).toBe(404);
    });
  });
});
