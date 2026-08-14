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
