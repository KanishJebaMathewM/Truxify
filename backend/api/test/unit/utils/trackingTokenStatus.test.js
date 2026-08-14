import { describe, it, expect } from 'vitest';
import { trackingTokenInvalidResponse, TRACKING_TOKEN_STATUS_MESSAGES } from '../../../src/utils/trackingTokenStatus.js';

describe('TRACKING_TOKEN_STATUS_MESSAGES', () => {
  it('has correct status for not_found', () => {
    expect(TRACKING_TOKEN_STATUS_MESSAGES.not_found.status).toBe(404);
    expect(TRACKING_TOKEN_STATUS_MESSAGES.not_found.message).toContain('not found');
  });

  it('has correct status for revoked', () => {
    expect(TRACKING_TOKEN_STATUS_MESSAGES.revoked.status).toBe(410);
    expect(TRACKING_TOKEN_STATUS_MESSAGES.revoked.message).toContain('revoked');
  });

  it('has correct status for expired', () => {
    expect(TRACKING_TOKEN_STATUS_MESSAGES.expired.status).toBe(410);
    expect(TRACKING_TOKEN_STATUS_MESSAGES.expired.message).toContain('expired');
  });
});

describe('trackingTokenInvalidResponse', () => {
  it('returns not_found for null/empty validation', () => {
    expect(trackingTokenInvalidResponse(null)).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.not_found);
    expect(trackingTokenInvalidResponse(undefined)).toEqual(TRACKING_TOKEN_STATUS_MESSAGES.not_found);
  });

  it('returns revoked response for revoked reason', () => {
    const result = trackingTokenInvalidResponse({ reason: 'revoked' });
    expect(result.status).toBe(410);
    expect(result.message).toContain('revoked');
  });

  it('returns expired response for expired reason', () => {
    const result = trackingTokenInvalidResponse({ reason: 'expired' });
    expect(result.status).toBe(410);
    expect(result.message).toContain('expired');
  });

  it('returns not_found for unknown reason', () => {
    const result = trackingTokenInvalidResponse({ reason: 'unknown' });
    expect(result.status).toBe(404);
  });

  it('returns not_found when reason is missing', () => {
    const result = trackingTokenInvalidResponse({});
    expect(result.status).toBe(404);
  });

  it('handles validation with extra fields', () => {
    const result = trackingTokenInvalidResponse({ reason: 'revoked', tokenId: 'tok-123', extra: 'data' });
    expect(result.status).toBe(410);
  });
});
