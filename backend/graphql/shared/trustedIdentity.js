import crypto from 'crypto';
import logger from '../../api/src/middleware/logger.js';

/**
 * Binds subgraph identity to the gateway.
 *
 * Subgraphs (order/driver/etc.) previously trusted `x-user-id` / `x-user-role`
 * headers verbatim. Because subgraphs are reachable on their own ports, any
 * client could forge those headers and impersonate another user or an admin
 * (IDOR / privilege escalation). The gateway now signs the trusted headers with
 * an HMAC over `SUBGRAPH_SHARED_SECRET`; subgraphs verify the signature and
 * reject any request that lacks a valid one.
 */

const SIGNATURE_HEADER = 'x-gateway-signature';

function getSecret() {
  const secret = process.env.SUBGRAPH_SHARED_SECRET;
  if (!secret) {
    logger.warn(
      '[trustedIdentity] SUBGRAPH_SHARED_SECRET is not set; trusted subgraph ' +
      'identity headers will not be signed/verified. Set it on both the ' +
      'gateway and subgraphs to enable protection.'
    );
  }
  return secret || '';
}

export function computeTrustedSignature(userId, role) {
  const secret = getSecret();
  if (!secret) return '';
  const payload = `${userId || ''}:${role || ''}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function resolveUserFromTrustedHeaders(reqHeaders) {
  const userId = reqHeaders['x-user-id'];
  const role = reqHeaders['x-user-role'];
  const signature = reqHeaders[SIGNATURE_HEADER];

  // No identity supplied -> unauthenticated. This also rejects requests that
  // arrive at a subgraph directly with forged x-user-id/x-user-role but no
  // gateway-produced signature.
  if (!userId || !signature) {
    return null;
  }

  const secret = process.env.SUBGRAPH_SHARED_SECRET;
  if (!secret) {
    // Misconfigured: we cannot verify, so refuse to trust the identity.
    return null;
  }

  const expected = crypto.createHmac('sha256', secret).update(`${userId}:${role || ''}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  return { id: userId, role };
}
