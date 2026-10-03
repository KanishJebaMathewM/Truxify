// Maps an invalid tracking-token `validation` result (from
// TrackingTokenService.validateToken) to a consistent HTTP status + message
// across both public tracking endpoints. `revoked`/`expired` → 410 (gone,
// client should request a fresh link); `not_found` (and any unmapped reason)
// → 404. See issue #10503.
export const TRACKING_TOKEN_STATUS_MESSAGES = {
  not_found: { status: 404, message: 'Tracking link not found or invalid' },
  revoked: { status: 410, message: 'This tracking link has been revoked' },
  expired: { status: 410, message: 'This tracking link has expired' },
};

export function trackingTokenInvalidResponse(validation) {
  if (!validation) {
    return TRACKING_TOKEN_STATUS_MESSAGES['not_found'];
  }
  const { status, message } =
    TRACKING_TOKEN_STATUS_MESSAGES[validation.reason] ||
    TRACKING_TOKEN_STATUS_MESSAGES.not_found;
  return { status, message };
}

/**
 * Determines shipment tracking token lifecycle state:
 * - 'cancelled' if revoked or cancelled
 * - 'expired' if expiration timestamp is in the past
 * - 'active' if valid and unexpired (or null expiry)
 * - 'invalid' if input or timestamp is malformed
 *
 * @param {object} token - Token object containing expires_at, revoked, cancelled flags
 * @param {Date|string|number} [now=new Date()] - Reference timestamp for comparison
 * @returns {'active'|'expired'|'cancelled'|'invalid'}
 */
export function getTrackingTokenStatus(token, now = new Date()) {
  if (!token || typeof token !== 'object') {
    return 'invalid';
  }
  if (token.revoked || token.cancelled || token.is_cancelled || token.status === 'cancelled' || token.status === 'revoked') {
    return 'cancelled';
  }
  if (token.expires_at === null || token.expires_at === undefined) {
    return 'active';
  }
  const expiryDate = token.expires_at instanceof Date ? token.expires_at : new Date(token.expires_at);
  if (!Number.isFinite(expiryDate.getTime())) {
    return 'invalid';
  }
  const currentDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(currentDate.getTime())) {
    return 'invalid';
  }
  if (expiryDate.getTime() <= currentDate.getTime()) {
    return 'expired';
  }
  return 'active';
}

export const determineTokenStatus = getTrackingTokenStatus;

