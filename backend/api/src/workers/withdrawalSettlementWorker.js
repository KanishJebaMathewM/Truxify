import { supabaseAdmin } from "../config/db.js";
import logger from "../middleware/logger.js";
import {
  dispatchPayout,
  isPayoutProviderConfigured,
  recoverSettlementRef,
} from "../services/wallet/payoutProvider.js";
import { sendPushNotification } from "../services/notificationService.js";
import { WorkerTracer } from "../core/telemetry/WorkerTracer.js";

const BATCH_LIMIT = 50;
const SETTLE_RETRY_ATTEMPTS = 3;
const SETTLE_RETRY_DELAYS_MS = [500, 1500, 3000];
const DEFAULT_MAX_RETRIES = 5;

// Persisting the settlement_ref is what guarantees a dispatched payout is
// never orphaned, so we retry harder (and longer) than the settle RPC itself.
const RECORD_PERSIST_ATTEMPTS = 6;
const RECORD_PERSIST_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000];

// A row that has been claimed (payout_attempted_at set) but is still missing a
// settlement_ref this long is almost certainly stuck and must be escalated.
const RECONCILE_STUCK_AFTER_MS = 60 * 60 * 1000;

let intervalId = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculates exponential backoff delay in seconds with a 1-hour cap.
 * Attempt 0 -> 60s (1m)
 * Attempt 1 -> 120s (2m)
 * Attempt 2 -> 240s (4m)
 * Attempt 3 -> 480s (8m)
 * Attempt 4 -> 960s (16m)
 */
export function calculateBackoffDelaySeconds(retryCount) {
  const BASE_SECONDS = 60;
  const MAX_SECONDS = 3600;
  return Math.min(BASE_SECONDS * Math.pow(2, Math.max(0, retryCount || 0)), MAX_SECONDS);
}

/**
 * Classifies a dispatchPayout failure as "ambiguous": the payout may already
 * have been committed at the gateway before the request timed out/errored, so
 * it is unsafe to assume nothing left the platform. These errors must NOT lead
 * to restoring reserved funds (which would double-pay the driver).
 *
 * The default is deliberately AMBIGUOUS. Restoring funds on an unproven failure
 * permanently double-credits the driver, whereas treating an unproven outcome as
 * ambiguous only delays the payout (backoff retry, then DLQ, then manual
 * reconciliation). Both directions are handled by the same worker, but they are
 * not symmetric in cost, so we fail toward the recoverable one.
 *
 * Consequently this is an allowlist of the only failures we can PROVE never
 * reached the provider - the argument validations that run before dispatchPayout
 * calls fetch(). Everything else is treated as ambiguous.
 *
 * The previous implementation inverted this and matched on error substrings, which
 * misclassified three real cases as "safe to refund":
 *
 *   1. "Payout webhook did not respond within 10000ms." - the AbortSignal
 *      timeout. Its message contains none of the ambiguity substrings
 *      (no "timeout", no "network", no 5xx), so an indeterminate payout was
 *      refunded, defeating the intent stated at the throw site itself.
 *   2. "Payout webhook returned HTTP 200 but body contains no settlement_ref" -
 *      a 2xx is positive evidence the payout was accepted. Failing to read the
 *      reference out of the body is not evidence the payout failed.
 *   3. HTTP 408/425/429 and any unrecognised transport/parse error.
 */
export function isAmbiguousDispatchError(err) {
  const msg = String((err && err.message) || "").toLowerCase();

  // Raised before any request leaves the process, so no money can have moved.
  const PROVED_NOT_DISPATCHED = [
    /invalid withdrawal amount/,
    /no withdrawal payout provider configured/,
    /not supported yet/,
  ];
  if (PROVED_NOT_DISPATCHED.some((pattern) => pattern.test(msg))) {
    return false;
  }

  return true;
}

/**
 * Atomically claims a pending withdrawal for this worker BEFORE the payout is
 * dispatched. The update is conditioned on payout_attempted_at IS NULL, so at
 * most one concurrent sweep can win the claim; losers skip the row entirely.
 * Returns true only when this caller reserved the row.
 */
async function claimWithdrawal(withdrawalId) {
  // This claim is the linearization point before an irreversible payout, so it
  // must re-assert EVERY precondition that makes a payout correct, not just
  // that the claim token is free.
  //
  // payout_attempted_at alone is insufficient because it is a reusable token:
  // schedule_withdrawal_retry and admin_resolve_dlq_withdrawal's requeue path
  // both deliberately reset it to NULL so the next sweep can re-claim. A row can
  // therefore legitimately be pending-and-unclaimed again while a worker still
  // holds a stale candidate snapshot, and it can leave 'pending' entirely
  // between the candidate SELECT and this UPDATE (fail_withdrawal_tx refunds the
  // wallet and marks the row failed without touching payout_attempted_at).
  //
  // Claiming such a row dispatches a real payout that settle_withdrawal_tx then
  // rejects (it only matches rows still in 'pending'), leaving money paid out on
  // an already-refunded withdrawal. Re-asserting status/settled_at/txn_type here
  // makes the claim match exactly the set the candidate SELECT chose from.
  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .update({ payout_attempted_at: new Date().toISOString() })
    .eq("id", withdrawalId)
    .eq("txn_type", "withdrawal")
    .eq("status", "pending")
    .is("settled_at", null)
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
 * the next sweep.
 */
async function recordDispatchOutcome(withdrawalId, settlementRef) {
  let lastError = null;
  for (let attempt = 1; attempt <= RECORD_PERSIST_ATTEMPTS; attempt += 1) {
    const { error } = await supabaseAdmin
      .from("wallet_transactions")
      .update({ settlement_ref: settlementRef })
      .eq("id", withdrawalId)
      .is("settlement_ref", null);

    if (!error) {
      return;
    }
    lastError = error;
    if (attempt < RECORD_PERSIST_ATTEMPTS) {
      await sleep(RECORD_PERSIST_DELAYS_MS[attempt - 1]);
    }
  }
  throw new Error(
    `[WithdrawalSettlementWorker] Failed to record dispatch outcome for ${withdrawalId} after ${SETTLE_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
  );
}

/**
 * Marks a pending withdrawal completed. Retried with a bounded backoff because
 * settle_withdrawal_tx is idempotent and only matches rows still in 'pending'.
 */
async function settleWithRetry(withdrawalId, settlementRef) {
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
 * Escalates a withdrawal that was claimed (payout_attempted_at set) but is
 * stuck without a settlement_ref and cannot be re-derived from the provider.
 */
async function flagForReconciliation(withdrawalId) {
  logger.error(
    `[WithdrawalSettlementWorker][RECONCILIATION-DLQ] Withdrawal ${withdrawalId} is stuck: payout was attempted but no settlement_ref could be recorded or re-derived. ` +
      `Manual reconciliation required — do NOT restore reserved funds until the provider payout status is confirmed.`,
  );
}

/**
 * Settles 'pending' withdrawal wallet_transactions:
 *   1. loads pending withdrawals whose next_retry_at <= now();
 *   2. atomically claims each unclaimed row (payout_attempted_at IS NULL);
 *   3. dispatches the payout through the configured payout provider;
 *   4. handles transient failures by scheduling an exponential backoff retry;
 *   5. transitions to DLQ if max retries are exceeded;
 *   6. emits driver status notifications on terminal/retry events.
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

  const nowIso = new Date().toISOString();
  let query = supabaseAdmin
    .from("wallet_transactions")
    .select(
      "id, driver_id, amount, payout_attempted_at, settlement_ref, settle_attempts, retry_count, max_retries, next_retry_at",
    )
    .eq("txn_type", "withdrawal")
    .eq("status", "pending")
    .is("settled_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  const { data: withdrawals, error } = await query;

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
    // If next_retry_at is in the future, skip until scheduled time
    if (withdrawal.next_retry_at && new Date(withdrawal.next_retry_at) > new Date(nowIso)) {
      continue;
    }

    let settlementRef = withdrawal.settlement_ref;

    if (!withdrawal.payout_attempted_at) {
      // 1. ATOMIC CLAIM
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

        try {
          await recordDispatchOutcome(withdrawal.id, settlementRef);
        } catch (recordErr) {
          logger.error(
            `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} payout dispatched but settlement_ref could not be persisted: ${recordErr.message}`,
          );
        }
      } catch (err) {
        if (isAmbiguousDispatchError(err)) {
          const currentRetries = withdrawal.retry_count || 0;
          const maxRetries = withdrawal.max_retries || DEFAULT_MAX_RETRIES;

          if (currentRetries < maxRetries) {
            const delaySec = calculateBackoffDelaySeconds(currentRetries);
            logger.warn(
              `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} ambiguous error (attempt ${currentRetries + 1}/${maxRetries}) — scheduling retry in ${delaySec}s: ${err.message}`,
            );

            await supabaseAdmin.rpc("schedule_withdrawal_retry", {
              p_withdrawal_id: withdrawal.id,
              p_error: String(err.message || "Ambiguous timeout / network error").slice(0, 1000),
              p_delay_seconds: delaySec,
            });

            try {
              await sendPushNotification(
                withdrawal.driver_id,
                "Withdrawal Retrying",
                "We experienced a temporary delay processing your withdrawal. It will be retried automatically.",
                "payment",
                { withdrawal_id: withdrawal.id, status: "retrying" },
              );
            } catch (notifErr) {
              logger.warn(`[WithdrawalSettlementWorker] Failed to send retry push notification: ${notifErr.message}`);
            }
          } else {
            logger.error(
              `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} exceeded max retries (${maxRetries}) — moving to DLQ: ${err.message}`,
            );

            await supabaseAdmin.rpc("move_withdrawal_to_dlq", {
              p_withdrawal_id: withdrawal.id,
              p_reason: `Exceeded max retries (${maxRetries}): ${err.message}`,
            });

            try {
              await sendPushNotification(
                withdrawal.driver_id,
                "Withdrawal Under Review",
                "Your withdrawal is currently under review by our operations team. Your funds remain secured.",
                "payment",
                { withdrawal_id: withdrawal.id, status: "under_review" },
              );
            } catch (notifErr) {
              logger.warn(`[WithdrawalSettlementWorker] Failed to send DLQ push notification: ${notifErr.message}`);
            }
          }
          continue;
        }

        // The payout never left the platform — safe to restore the reserved funds
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
        } else {
          try {
            await sendPushNotification(
              withdrawal.driver_id,
              "Withdrawal Failed",
              "Your withdrawal could not be completed. The reserved funds have been restored to your wallet.",
              "payment",
              { withdrawal_id: withdrawal.id, status: "failed" },
            );
          } catch (notifErr) {
            logger.warn(`[WithdrawalSettlementWorker] Failed to send failure push notification: ${notifErr.message}`);
          }
        }
        continue;
      }
    }

    if (!settlementRef) {
      const attemptedAt = withdrawal.payout_attempted_at
        ? Date.parse(withdrawal.payout_attempted_at)
        : null;
      const stuckMs = attemptedAt ? Date.now() - attemptedAt : Infinity;

      if (stuckMs >= RECONCILE_STUCK_AFTER_MS) {
        await flagForReconciliation(withdrawal.id);
        continue;
      }

      const recovered = await recoverSettlementRef({
        withdrawalId: withdrawal.id,
      });

      if (recovered) {
        settlementRef = recovered;
        logger.warn(
          `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} settlement_ref re-derived from provider (ref: ${recovered}) — persisting and settling.`,
        );
        try {
          await recordDispatchOutcome(withdrawal.id, recovered);
        } catch (recordErr) {
          logger.error(
            `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} re-derived settlement_ref could not be persisted: ${recordErr.message}`,
          );
        }
      } else {
        logger.warn(
          `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} claimed but settlement_ref still unrecorded — retrying reconciliation on next sweep.`,
        );
        continue;
      }
    }

    try {
      await settleWithRetry(withdrawal.id, settlementRef);
      logger.info(
        `[WithdrawalSettlementWorker] Settled withdrawal ${withdrawal.id} (ref: ${settlementRef}).`,
      );

      try {
        await sendPushNotification(
          withdrawal.driver_id,
          "Withdrawal Completed",
          "Your wallet withdrawal has been processed and paid out successfully.",
          "payment",
          { withdrawal_id: withdrawal.id, status: "completed", settlement_ref: settlementRef },
        );
      } catch (notifErr) {
        logger.warn(`[WithdrawalSettlementWorker] Failed to send completion push notification: ${notifErr.message}`);
      }
    } catch (err) {
      const attempts = (withdrawal.settle_attempts || 0) + 1;
      const terminal = attempts >= SETTLE_RETRY_ATTEMPTS;
      const errorMsg = String(err.message || "Unknown error").slice(0, 1000);

      try {
        const { error: rpcErr } = await supabaseAdmin.rpc(
          "record_settle_failure",
          {
            p_withdrawal_id: withdrawal.id,
            p_error: errorMsg,
            p_terminal: terminal,
          },
        );
        if (rpcErr) {
          logger.error(
            `[WithdrawalSettlementWorker] Failed to record settlement failure for ${withdrawal.id}: ${rpcErr.message}`,
          );
        }
      } catch (rpcErr) {
        logger.error(
          `[WithdrawalSettlementWorker] Failed to record settlement failure for ${withdrawal.id}: ${rpcErr.message}`,
        );
      }

      if (terminal) {
        logger.error(
          `[WithdrawalSettlementWorker] Withdrawal ${withdrawal.id} settlement permanently failed after ${attempts} attempts — moved to terminal settlement_failed status. ALERT: manual reconciliation required (funds NOT restored).`,
        );

        try {
          await sendPushNotification(
            withdrawal.driver_id,
            "Withdrawal Under Review",
            "Your withdrawal has been queued for manual review by our finance team.",
            "payment",
            { withdrawal_id: withdrawal.id, status: "under_review" },
          );
        } catch (notifErr) {
          logger.warn(`[WithdrawalSettlementWorker] Failed to send review push notification: ${notifErr.message}`);
        }
      } else {
        logger.error(
          `[WithdrawalSettlementWorker] Settlement of withdrawal ${withdrawal.id} deferred (attempt ${attempts}/${SETTLE_RETRY_ATTEMPTS}) — payout already dispatched, funds NOT restored: ${err.message}`,
        );
      }
    }
  }
}

export const startWithdrawalSettlementWorker = () => {
  if (intervalId) return;

  const INTERVAL_MS = 5 * 60 * 1000; // Batch process every 5 minutes

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
