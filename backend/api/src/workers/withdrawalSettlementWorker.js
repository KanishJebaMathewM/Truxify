import { supabaseAdmin } from "../config/db.js";
import logger from "../middleware/logger.js";
import {
  dispatchPayout,
  isPayoutProviderConfigured,
} from "../services/wallet/payoutProvider.js";
import { WorkerTracer } from "../core/telemetry/WorkerTracer.js";

const BATCH_LIMIT = 50;
const SETTLE_RETRY_ATTEMPTS = 3;
const SETTLE_RETRY_DELAYS_MS = [500, 1500, 3000];

let intervalId = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Atomically claims a pending withdrawal for this worker BEFORE the payout is
 * dispatched. The update is conditioned on payout_attempted_at IS NULL, so at
 * most one concurrent sweep can win the claim; losers skip the row entirely.
 * Returns true only when this caller reserved the row.
 */
async function claimWithdrawal(withdrawalId) {
  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .update({ payout_attempted_at: new Date().toISOString() })
    .eq("id", withdrawalId)
    .is("payout_attempted_at", null)
    .select("id");

  if (error) {
    logger.error(
      `[WithdrawalSettlementWorker] Failed to claim withdrawal ${withdrawalId}: ${error.message}`,
    );
    return false;
  }
  return data && data.length > 0;
}

/**
 * Records the dispatch outcome on the already-claimed row so a crash between
 * dispatch and the completion RPC is detected and re-settled (not failed) on
 * the next sweep. Best-effort: failure to record only delays detection.
 */
async function recordDispatchOutcome(withdrawalId, settlementRef) {
  const { error } = await supabaseAdmin
    .from("wallet_transactions")
    .update({ settlement_ref: settlementRef })
    .eq("id", withdrawalId)
    .is("settlement_ref", null);

  if (error) {
    logger.warn(
      `[WithdrawalSettlementWorker] Failed to record dispatch outcome for ${withdrawalId}: ${error.message}`,
    );
  }
}

/**
 * Marks a pending withdrawal completed. Retried with a bounded backoff because
 * settle_withdrawal_tx is idempotent and only matches rows still in 'pending'.
 */
async function settleWithRetry(withdrawalId, settlementRef) {
  // settle_withdrawal_tx happily marks a withdrawal 'completed' and releases
  // the reserved wallet_pending balance even when p_settlement_ref is NULL.
  // Never settle without an actual payout reference: the row may have been
  // claimed but the payout never confirmed dispatched (crash window).
  if (!settlementRef) {
    throw new Error(
      `Refusing to settle withdrawal ${withdrawalId}: no payout settlement reference recorded.`,
    );
  }
  let lastError = null;
  for (let attempt = 1; attempt <= SETTLE_RETRY_ATTEMPTS; attempt += 1) {
    const { error } = await supabaseAdmin.rpc("settle_withdrawal_tx", {
      p_withdrawal_id: withdrawalId,
      p_settlement_ref: settlementRef,
    });
    if (!error) {
      return true;
    }
    lastError = error;
    if (attempt < SETTLE_RETRY_ATTEMPTS) {
      await sleep(SETTLE_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  throw new Error(
    `Failed to settle withdrawal ${withdrawalId}: ${lastError.message}`,
  );
}

/**
 * Settles 'pending' withdrawal wallet_transactions:
 *   1. loads the oldest un-settled pending withdrawals;
 *   2. atomically claims each unclaimed row (payout_attempted_at IS NULL) so
 *      exactly one concurrent sweep dispatches it;
 *   3. dispatches the payout through the configured payout provider;
 *   4. marks the withdrawal completed (settle_withdrawal_tx) or failed
 *      (fail_withdrawal_tx) with the reserved funds restored to
 *      wallet_confirmed.
 *
 * Failure-mode split (Issue #6274):
 *   - dispatchPayout failed BEFORE money left the platform -> fail the
 *     withdrawal and restore the reserved funds to wallet_confirmed;
 *   - dispatchPayout succeeded but settle_withdrawal_tx failed -> NEVER
 *     restore funds. The row stays 'pending' with payout_attempted_at set so
 *     the next sweep detects it and retries the (idempotent) settle call.
 */
export async function settlePendingWithdrawals() {
  if (!supabaseAdmin) {
    logger.warn(
      "[WithdrawalSettlementWorker] supabaseAdmin unavailable - skipping settlement cycle.",
    );
    return;
  }

  if (!isPayoutProviderConfigured()) {
    logger.warn(
      "[WithdrawalSettlementWorker] No payout provider configured (WITHDRAWAL_PAYOUT_PROVIDER / WITHDRAWAL_PAYOUT_WEBHOOK_URL) - skipping so withdrawals are never falsely completed.",
    );
    return;
  }

  const { data: withdrawals, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id, driver_id, amount, payout_attempted_at, settlement_ref")
    .eq("txn_type", "withdrawal")
    .eq("status", "pending")
    .is("settled_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    logger.error(
      `[WithdrawalSettlementWorker] Failed to load pending withdrawals: ${error.message}`,
    );
    return;
  }

  if (!withdrawals || withdrawals.length === 0) {
    return;
  }

  for (const withdrawal of withdrawals) {
    let settlementRef = withdrawal.settlement_ref;

    if (!withdrawal.payout_attempted_at) {
      // 1. ATOMIC CLAIM: reserve the row BEFORE dispatching so two concurrent
      //    sweeps cannot both call dispatchPayout for the same withdrawal.
      const claimed = await claimWithdrawal(withdrawal.id);
      if (!claimed) {
        logger.info(
          `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} already claimed by another worker - skipping dispatch.`,
        );
        continue;
      }

      try {
        const result = await dispatchPayout({
          driverId: withdrawal.driver_id,
          withdrawal,
        });
        settlementRef = result.settlementRef;

        // 2. Persist the dispatch outcome BEFORE the completion RPC so a crash
        //    in between is detected and settled (not failed) on the next sweep.
        await recordDispatchOutcome(withdrawal.id, settlementRef);
      } catch (err) {
        // The payout never left the platform — safe to restore the reserved
        // funds to wallet_confirmed.
        logger.error(
          `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} payout dispatch failed: ${err.message}`,
        );

        const { error: failErr } = await supabaseAdmin.rpc(
          "fail_withdrawal_tx",
          {
            p_withdrawal_id: withdrawal.id,
            p_error: String(err.message || "Unknown error").slice(0, 1000),
          },
        );

        if (failErr) {
          logger.error(
            `[WithdrawalSettlementWorker] Failed to mark withdrawal ${withdrawal.id} as failed: ${failErr.message}`,
          );
        }
        continue;
      }
    }

    // The payout has already been dispatched (payout_attempted_at is set), so
    // never call fail_withdrawal_tx here — restoring wallet_confirmed would
    // double-pay the driver. Keep the row 'pending' and let the next sweep
    // retry the idempotent settle call. If the settlement reference is still
    // missing, the row may have been claimed but the dispatch never produced a
    // payout reference (crash window) — refuse to settle so the withdrawal is
    // not falsely marked completed with no payout having left the platform.
    if (!settlementRef) {
      logger.warn(
        `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} was claimed but no payout settlement reference was recorded - refusing to settle, keeping funds reserved.`,
      );
      continue;
    }

    try {
      await settleWithRetry(withdrawal.id, settlementRef);
      logger.info(
        `[WithdrawalSettlementWorker] Settled withdrawal ${withdrawal.id} (ref: ${settlementRef}).`,
      );
    } catch (err) {
      logger.error(
        `[WithdrawalSettlementWorker] Settlement of withdrawal ${withdrawal.id} deferred — payout already dispatched, funds NOT restored: ${err.message}`,
      );
    }
  }
}

export const startWithdrawalSettlementWorker = () => {
  if (intervalId) return;

  const INTERVAL_MS = 60 * 1000; // Poll every 1 minute

  const tracedHandler = WorkerTracer.wrapIntervalWorker(
    "withdrawal-settlement-worker",
    async () => {
      await settlePendingWithdrawals();
    },
    { intervalMs: INTERVAL_MS },
  );

  intervalId = setInterval(async () => {
    try {
      await tracedHandler();
    } catch (err) {
      logger.error(
        `[WithdrawalSettlementWorker] Error in polling loop: ${err.message}`,
      );
    }
  }, INTERVAL_MS);

  logger.info(
    "[WithdrawalSettlementWorker] Started wallet withdrawal settlement worker.",
  );
};

export const stopWithdrawalSettlementWorker = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info(
      "[WithdrawalSettlementWorker] Stopped wallet withdrawal settlement worker.",
    );
  }
};
