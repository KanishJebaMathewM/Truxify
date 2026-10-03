import { describe, it, expect } from 'vitest';
import {
  TRACKING_TOKEN_STATUS_MESSAGES,
  trackingTokenInvalidResponse,
  getTrackingTokenStatus,
  determineTokenStatus,
} from '../../src/utils/trackingTokenStatus.js';

describe('trackingTokenStatus', () => {
  describe('TRACKING_TOKEN_STATUS_MESSAGES', () => {
    it('defines status code and message for not_found (404)', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES.not_found).toEqual({
        status: 404,
        message: 'Tracking link not found or invalid',
      });
    });

    it('defines status code and message for revoked (410)', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES.revoked).toEqual({
        status: 410,
        message: 'This tracking link has been revoked',
      });
    });

    it('defines status code and message for expired (410)', () => {
      expect(TRACKING_TOKEN_STATUS_MESSAGES.expired).toEqual({
        status: 410,
        message: 'This tracking link has expired',
      });
    });
  });

  describe('trackingTokenInvalidResponse', () => {
    it('returns not_found (404) when validation input is null or undefined', () => {
      expect(trackingTokenInvalidResponse(null)).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.not_found);
      expect(trackingTokenInvalidResponse(undefined)).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.not_found);
    });

    it('returns revoked (410) for reason: "revoked"', () => {
      const result = trackingTokenInvalidResponse({ reason: 'revoked' });
      expect(result.status).toBe(410);
      expect(result.message).toBe('This tracking link has been revoked');
    });

    it('returns expired (410) for reason: "expired"', () => {
      const result = trackingTokenInvalidResponse({ reason: 'expired' });
      expect(result.status).toBe(410);
      expect(result.message).toBe('This tracking link has expired');
    });

    it('defaults to not_found (404) for unknown or unmapped reasons', () => {
      expect(trackingTokenInvalidResponse({ reason: 'unknown_reason' })).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.not_found);
      expect(trackingTokenInvalidResponse({ reason: 'validation_error' })).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.not_found);
      expect(trackingTokenInvalidResponse({})).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.not_found);
    });

    it('handles validation object with extra fields correctly', () => {
      const result = trackingTokenInvalidResponse({
        reason: 'revoked',
        tokenId: 'token-uuid-1234',
        extraMetadata: { orderId: 'ord-123' },
      });
      expect(result).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.revoked);
    });
  });

  describe('getTrackingTokenStatus / determineTokenStatus', () => {
    const NOW = new Date('2026-06-15T12:00:00.000Z');

    it('aliases determineTokenStatus to getTrackingTokenStatus', () => {
      expect(determineTokenStatus).toBe(getTrackingTokenStatus);
    });

    describe('Token States', () => {
      it('returns "active" for a valid token with future expiration date', () => {
        const token = {
          id: 'tok-1',
          expires_at: '2026-06-20T12:00:00.000Z',
          revoked: false,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('active');
      });

      it('returns "expired" for a token with past expiration date', () => {
        const token = {
          id: 'tok-2',
          expires_at: '2026-06-10T12:00:00.000Z',
          revoked: false,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('expired');
      });

      it('returns "cancelled" when token has revoked: true', () => {
        const token = {
          id: 'tok-3',
          expires_at: '2026-06-20T12:00:00.000Z',
          revoked: true,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('cancelled');
      });

      it('returns "cancelled" when token has cancelled: true', () => {
        const token = {
          id: 'tok-4',
          expires_at: '2026-06-20T12:00:00.000Z',
          cancelled: true,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('cancelled');
      });

      it('returns "cancelled" when token has is_cancelled: true', () => {
        const token = {
          id: 'tok-5',
          expires_at: '2026-06-20T12:00:00.000Z',
          is_cancelled: true,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('cancelled');
      });

      it('returns "cancelled" when token status string is "cancelled" or "revoked"', () => {
        expect(getTrackingTokenStatus({ status: 'cancelled' }, NOW)).toBe('cancelled');
        expect(getTrackingTokenStatus({ status: 'revoked' }, NOW)).toBe('cancelled');
      });

      it('prioritizes cancellation over expiration even if expires_at is past', () => {
        const token = {
          expires_at: '2026-01-01T00:00:00.000Z',
          revoked: true,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('cancelled');
      });
    });

    describe('Edge Cases', () => {
      it('handles null expiry as active (non-expiring token)', () => {
        const token = { id: 'tok-non-expiring', expires_at: null, revoked: false };
        expect(getTrackingTokenStatus(token, NOW)).toBe('active');
      });

      it('handles undefined expiry as active', () => {
        const token = { id: 'tok-no-expiry-field', revoked: false };
        expect(getTrackingTokenStatus(token, NOW)).toBe('active');
      });

      it('handles far-future expiry date correctly', () => {
        const token = {
          expires_at: '2099-12-31T23:59:59.999Z',
          revoked: false,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('active');
      });

      it('handles far-past expiry date correctly', () => {
        const token = {
          expires_at: '1999-01-01T00:00:00.000Z',
          revoked: false,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('expired');
      });

      it('treats exact timestamp match (expires_at == now) as expired', () => {
        const token = {
          expires_at: NOW.toISOString(),
          revoked: false,
        };
        expect(getTrackingTokenStatus(token, NOW)).toBe('expired');
      });

      it('uses current system time when now parameter is omitted', () => {
        const futureToken = {
          expires_at: new Date(Date.now() + 60000).toISOString(),
          revoked: false,
        };
        const pastToken = {
          expires_at: new Date(Date.now() - 60000).toISOString(),
          revoked: false,
        };
        expect(getTrackingTokenStatus(futureToken)).toBe('active');
        expect(getTrackingTokenStatus(pastToken)).toBe('expired');
      });
    });

    describe('String vs Date Comparison', () => {
      it('compares Date object expires_at with Date object now', () => {
        const futureDate = new Date(NOW.getTime() + 3600000);
        const pastDate = new Date(NOW.getTime() - 3600000);

        expect(getTrackingTokenStatus({ expires_at: futureDate }, NOW)).toBe('active');
        expect(getTrackingTokenStatus({ expires_at: pastDate }, NOW)).toBe('expired');
      });

      it('compares ISO string expires_at with Date object now', () => {
        expect(getTrackingTokenStatus({ expires_at: '2026-06-16T00:00:00.000Z' }, NOW)).toBe('active');
        expect(getTrackingTokenStatus({ expires_at: '2026-06-14T00:00:00.000Z' }, NOW)).toBe('expired');
      });

      it('compares Date object expires_at with ISO string now', () => {
        const expiresAt = new Date('2026-06-20T00:00:00.000Z');
        expect(getTrackingTokenStatus({ expires_at: expiresAt }, '2026-06-15T00:00:00.000Z')).toBe('active');
        expect(getTrackingTokenStatus({ expires_at: expiresAt }, '2026-06-25T00:00:00.000Z')).toBe('expired');
      });

      it('compares ISO string expires_at with ISO string now', () => {
        expect(getTrackingTokenStatus({ expires_at: '2026-06-20T00:00:00.000Z' }, '2026-06-15T00:00:00.000Z')).toBe('active');
        expect(getTrackingTokenStatus({ expires_at: '2026-06-10T00:00:00.000Z' }, '2026-06-15T00:00:00.000Z')).toBe('expired');
      });

      it('compares string expires_at with epoch millisecond timestamp now', () => {
        const nowMs = NOW.getTime();
        expect(getTrackingTokenStatus({ expires_at: '2026-06-20T00:00:00.000Z' }, nowMs)).toBe('active');
        expect(getTrackingTokenStatus({ expires_at: '2026-06-10T00:00:00.000Z' }, nowMs)).toBe('expired');
      });
    });

    describe('Invalid Input Handling', () => {
      it('returns "invalid" for null or undefined token', () => {
        expect(getTrackingTokenStatus(null, NOW)).toBe('invalid');
        expect(getTrackingTokenStatus(undefined, NOW)).toBe('invalid');
      });

      it('returns "invalid" for non-object primitive inputs', () => {
        expect(getTrackingTokenStatus('invalid-string', NOW)).toBe('invalid');
        expect(getTrackingTokenStatus(12345, NOW)).toBe('invalid');
        expect(getTrackingTokenStatus(true, NOW)).toBe('invalid');
      });

      it('returns "invalid" for unparseable / malformed expires_at date string', () => {
        expect(getTrackingTokenStatus({ expires_at: 'not-a-date' }, NOW)).toBe('invalid');
        expect(getTrackingTokenStatus({ expires_at: '2026-99-99' }, NOW)).toBe('invalid');
        expect(getTrackingTokenStatus({ expires_at: NaN }, NOW)).toBe('invalid');
        expect(getTrackingTokenStatus({ expires_at: Infinity }, NOW)).toBe('invalid');
        expect(getTrackingTokenStatus({ expires_at: -Infinity }, NOW)).toBe('invalid');
      });

      it('returns "invalid" when now parameter is an invalid date string or non-finite timestamp', () => {
        expect(getTrackingTokenStatus({ expires_at: '2026-06-20T00:00:00.000Z' }, 'invalid-now-date')).toBe('invalid');
        expect(getTrackingTokenStatus({ expires_at: '2026-06-20T00:00:00.000Z' }, NaN)).toBe('invalid');
        expect(getTrackingTokenStatus({ expires_at: '2026-06-20T00:00:00.000Z' }, Infinity)).toBe('invalid');
        expect(getTrackingTokenStatus({ expires_at: '2026-06-20T00:00:00.000Z' }, -Infinity)).toBe('invalid');
      });
    });
  });
});
