import logger from '../../middleware/logger.js';
import { supabaseAdmin, supabase } from '../../config/db.js';

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

const DEFAULT_SETTLEMENT_REF_PATTERN = /^[A-Za-z0-9_\-.:#/]{2,128}$/;

export function isValidSettlementRef(ref) {
  if (!ref || typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed === '[object Object]') {
    return false;
  }
  const customPattern = process.env.WITHDRAWAL_SETTLEMENT_REF_PATTERN || process.env.WITHDRAWAL_PAYOUT_REF_PATTERN;
  if (customPattern) {
    try {
      const regex = new RegExp(customPattern);
      return regex.test(trimmed);
    } catch (err) {
      logger.warn(`[PayoutProvider] Invalid custom settlement ref regex "${customPattern}": ${err.message}`);
    }
  }
  return DEFAULT_SETTLEMENT_REF_PATTERN.test(trimmed);
}

export async function dispatchPayout({ driverId, withdrawal }) {
  if (!Number.isFinite(withdrawal.amount) || withdrawal.amount <= 0) {
    throw new Error(`Invalid withdrawal amount: ${withdrawal.amount}. Amount must be a positive number.`);
  }
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
        throw new Error(`Payout webhook did not respond within ${timeoutMs}ms.`, { cause: err });
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(`Payout webhook returned HTTP ${response.status}.`);
    }

    const body = await response.json().catch(() => null);
    const settlementRef = body && typeof body === 'object'
      ? (body.settlement_ref || body.reference)
      : null;
    if (!settlementRef || typeof settlementRef !== 'string') {
      logger.warn('[PayoutProvider] Payout webhook returned HTTP 200 but body contains no settlement_ref or reference.');
      throw new Error('Payout webhook returned HTTP 200 but body contains no settlement_ref or reference.');
    }

    if (!isValidSettlementRef(settlementRef)) {
      logger.warn(
        { settlementRef, driverId, withdrawalId: withdrawal?.id },
        `[PayoutProvider] Payout webhook returned invalid settlement_ref pattern: "${settlementRef}". Treating as failed payout.`
      );
      throw new Error(`Payout webhook returned invalid settlement_ref pattern: "${settlementRef}".`);
    }

    return {
      success: true,
      settlementRef: settlementRef.trim(),
    };
  }

  logger.error(`[PayoutProvider] Provider "${provider}" is not wired up. Configure WITHDRAWAL_PAYOUT_WEBHOOK_URL.`);
  throw new Error(`Withdrawal payout provider "${provider}" is not supported yet.`);
}

/**
 * Best-effort recovery of a payout's settlement reference from the provider.
 *
 * A withdraw can be left with `payout_attempted_at` set but `settlement_ref`
 * NULL in the database when the persist between dispatch and completion fails
 * (Issue #14686). As long as the payout actually left the platform we must be
 * able to re-derive the reference rather than orphaning the driver's funds.
 *
 * Providers that support status lookup opt in via WITHDRAWAL_PAYOUT_STATUS_URL;
 * the platform previously sent `reference: "w<withdrawalId>"` to the dispatch
 * webhook, which the status endpoint can resolve back to a settlement_ref.
 * When no status endpoint is configured (or the lookup fails) we return null so
 * the caller can flag the row for manual reconciliation instead of guessing.
 */
export async function recoverSettlementRef({ withdrawalId }) {
  const statusUrl = process.env.WITHDRAWAL_PAYOUT_STATUS_URL;
  if (!statusUrl) {
    return null;
  }

  try {
    const response = await fetch(
      `${statusUrl}${statusUrl.includes('?') ? '&' : '?'}reference=w${withdrawalId}`,
      {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(payoutTimeoutMs()),
      },
    );

    if (!response.ok) {
      return null;
    }

    const body = await response.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return null;
    }

    const rawRef = body.settlement_ref || body.reference || null;
    if (!rawRef || !isValidSettlementRef(rawRef)) {
      if (rawRef) {
        logger.warn(
          { rawRef, withdrawalId },
          `[PayoutProvider] Recovered settlement_ref does not match valid pattern: "${rawRef}"`
        );
      }
      return null;
    }

    return rawRef.trim();
  } catch (err) {
    logger.error(
      `[PayoutProvider] Failed to recover settlement ref for withdrawal ${withdrawalId}: ${err.message}`,
    );
    return null;
  }
}

/**
 * Retrieves a payout record from Supabase with explicit null guards.
 * Returns structured error response { error: 'Payout record not found' } instead of null.
 */
export async function getPayoutRecord(payoutId, client = supabaseAdmin || supabase) {
  if (!payoutId) {
    return { error: 'Payout record not found' };
  }
  if (!client) {
    return { error: 'Payout record not found' };
  }

  try {
    const { data: payout, error } = await client
      .from('payouts')
      .select('*')
      .eq('id', payoutId)
      .maybeSingle();

    if (error || !payout) {
      const { data: tx, error: txError } = await client
        .from('wallet_transactions')
        .select('*')
        .eq('id', payoutId)
        .maybeSingle();

      if (txError || !tx) {
        return { error: 'Payout record not found' };
      }
      return tx;
    }

    return payout;
  } catch (err) {
    logger.error(`[PayoutProvider] Failed to fetch payout record: ${err.message}`);
    return { error: 'Payout record not found' };
  }
}

export async function getPayoutStatus(payoutId, client = supabaseAdmin || supabase) {
  const record = await getPayoutRecord(payoutId, client);
  if (!record || record.error) {
    return { error: 'Payout record not found' };
  }
  return record;
}

export async function getPayoutById(payoutId, client = supabaseAdmin || supabase) {
  return getPayoutRecord(payoutId, client);
}

export async function getPayout(payoutId, client = supabaseAdmin || supabase) {
  return getPayoutRecord(payoutId, client);
}

export async function fetchPayout(payoutId, client = supabaseAdmin || supabase) {
  return getPayoutRecord(payoutId, client);
}

export async function fetchPayoutRecord(payoutId, client = supabaseAdmin || supabase) {
  return getPayoutRecord(payoutId, client);
}

