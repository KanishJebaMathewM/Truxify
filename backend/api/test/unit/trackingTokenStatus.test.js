import { describe, it, expect } from 'vitest';

// #10503: the /route endpoint must mirror the main tracking endpoint's status
// mapping for invalid tokens. This is a pure unit test of the shared helper
// (no HTTP layer) so it runs independently of the integration suite, whose
// route module currently cannot be imported on main due to an unrelated
// pre-existing duplicate-export parse error in requestSchemas.js (#10082).

import {
  trackingTokenInvalidResponse,
  TRACKING_TOKEN_STATUS_MESSAGES,
} from '../../src/utils/trackingTokenStatus.js';

describe('trackingTokenInvalidResponse', () => {
  it('maps revoked → 410', () => {
    const { status, message } = trackingTokenInvalidResponse({
      valid: false,
      reason: 'revoked',
    });
    expect(status).toBe(410);
    expect(message).toBe('This tracking link has been revoked');
  });

  it('maps expired → 410', () => {
    const { status, message } = trackingTokenInvalidResponse({
      valid: false,
      reason: 'expired',
    });
    expect(status).toBe(410);
    expect(message).toBe('This tracking link has expired');
  });

  it('maps not_found → 404', () => {
    const { status, message } = trackingTokenInvalidResponse({
      valid: false,
      reason: 'not_found',
    });
    expect(status).toBe(404);
    expect(message).toBe('Tracking link not found or invalid');
  });

  it('falls back to 404 for an unmapped reason', () => {
    const { status, message } = trackingTokenInvalidResponse({
      valid: false,
      reason: 'something_unexpected',
    });
    expect(status).toBe(404);
    expect(message).toBe('Tracking link not found or invalid');
  });

  it('falls back to 404 when reason is missing', () => {
    const { status, message } = trackingTokenInvalidResponse({ valid: false });
    expect(status).toBe(404);
    expect(message).toBe('Tracking link not found or invalid');
  });

  it('never returns 404 for revoked or expired (the #10503 regression)', () => {
    for (const reason of ['revoked', 'expired']) {
      const { status } = trackingTokenInvalidResponse({
        valid: false,
        reason,
      });
      expect(status).toBe(410);
    }
  });

  it('exposes the message map for the three known states', () => {
    expect(Object.keys(TRACKING_TOKEN_STATUS_MESSAGES).sort()).toEqual(
      ['expired', 'not_found', 'revoked'],
    );
    expect(TRACKING_TOKEN_STATUS_MESSAGES.revoked.status).toBe(410);
    expect(TRACKING_TOKEN_STATUS_MESSAGES.expired.status).toBe(410);
    expect(TRACKING_TOKEN_STATUS_MESSAGES.not_found.status).toBe(404);
  });
});
