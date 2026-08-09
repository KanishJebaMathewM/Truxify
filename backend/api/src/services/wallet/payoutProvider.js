import logger from '../../middleware/logger.js';

/**
 * Payout dispatcher for driver wallet withdrawals.
 *
 * Withdrawals fail closed: when no payout provider is configured we refuse to
 * record a payout instead of silently parking driver money in wallet_pending.
 *
 * Configuration (via environment):
 *   WITHDRAWAL_PAYOUT_PROVIDER  - provider name (reserved for future SDKs)
 *   WITHDRAWAL_PAYOUT_WEBHOOK_URL - HTTP endpoint that executes the payout;
 *                                   it must POST back a JSON body with a
 *                                   `settlement_ref` (or `reference`) string.
 *   WITHDRAWAL_PAYOUT_TIMEOUT_MS  - abort the payout request after this many
 *                                   milliseconds (default 15000).
 */

const DEFAULT_PAYOUT_TIMEOUT_MS = 15000;

function payoutTimeoutMs() {
  const configured = Number(process.env.WITHDRAWAL_PAYOUT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_PAYOUT_TIMEOUT_MS;
}

export function isPayoutProviderConfigured() {
  return Boolean(
    process.env.WITHDRAWAL_PAYOUT_PROVIDER ||
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL
  );
}

export async function dispatchPayout({ driverId, withdrawal }) {
  const provider = process.env.WITHDRAWAL_PAYOUT_PROVIDER;
  const webhookUrl = process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL;

  if (!isPayoutProviderConfigured()) {
    throw new Error(
      'No withdrawal payout provider configured (WITHDRAWAL_PAYOUT_PROVIDER / WITHDRAWAL_PAYOUT_WEBHOOK_URL).'
    );
  }

  if (webhookUrl) {
    const timeoutMs = payoutTimeoutMs();
    let response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          driver_id: driverId,
          withdrawal_id: withdrawal.id,
          amount: withdrawal.amount,
          reference: `w${withdrawal.id}`,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // A timeout is indistinguishable from any other transport failure: the
      // payout may or may not have been accepted. Surface it as a dispatch
      // failure so the caller keeps its existing fail-safe handling rather
      // than hanging the settlement worker forever.
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new Error(`Payout webhook did not respond within ${timeoutMs}ms.`);
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(`Payout webhook returned HTTP ${response.status}.`);
    }

    const body = await response.json().catch(() => ({}));
    return {
      success: true,
      settlementRef:
        body.settlement_ref || body.reference || `w${withdrawal.id}`,
    };
  }

  logger.error(`[PayoutProvider] Provider "${provider}" is not wired up. Configure WITHDRAWAL_PAYOUT_WEBHOOK_URL.`);
  throw new Error(`Withdrawal payout provider "${provider}" is not supported yet.`);
}
