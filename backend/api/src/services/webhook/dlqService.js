import os from 'os';
import { supabase, supabaseAdmin } from '../../config/db.js';
import logger from '../../middleware/logger.js';

// Retry backoff in minutes, preserved from the original implementation:
// after failure N (retry_count=N) the next attempt is scheduled
// next_retry_at = now + RETRY_BACKOFF[N]. Once newRetryCount exceeds the
// array length there is no next attempt and the event fails permanently.
const RETRY_BACKOFF = [1, 5, 15, 60];

const DEFAULT_BATCH_SIZE = 50;
// Lease must be comfortably longer than one processing cycle (escrow webhook
// reconciliation is fast in-DB work, well under a second per event) yet finite
// so a crashed worker's claims are reclaimed quickly.
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

// A row whose lease expired this many times is treated as a crash casualty and
// escalated to failed_permanently instead of being reclaimed forever.
const DEFAULT_MAX_ATTEMPTS = 25;

function configuredInt(envName, fallback) {
  const raw = process.env[envName];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Stable, per-process worker identity used for:
 *   - claim ownership (claimed_by),
 *   - lease-reclaim fencing,
 *   - debugging and telemetry.
 * Does not expose any sensitive infrastructure information.
 */
export function getWorkerId() {
  return `${process.env.HOSTNAME || os.hostname()}-${process.pid}`;
}

/**
 * Derive a provider-level event identity from the enqueued payload so that
 * duplicate provider deliveries collapse onto a single DLQ row. Reuses the
 * payload's orderId/txHash rather than inventing new provider APIs.
 */
export function buildDedupeKey(provider, eventType, payload = {}) {
  const orderId = String(payload.orderId ?? '').trim().toLowerCase();
  const txHash = String(payload.txHash ?? '').trim().toLowerCase();
  return `${String(provider).toLowerCase()}:${String(eventType).toLowerCase()}:${orderId}:${txHash}`;
}

function sanitizeError(error) {
  if (!error) return null;
  const code = typeof error === 'object' && error !== null ? error.code : undefined;
  const message = typeof error === 'string' ? error : (error.message || String(error));
  const full = code ? `[${code}] ${message}` : message;
  return full.slice(0, 1000);
}

function isPermanentFailure(error) {
  return Boolean(error && typeof error === 'object' && error.retryable === false);
}

function isUniqueViolation(error) {
  if (!error) return false;
  return error.code === '23505' || /duplicate key value violates unique constraint/i.test(error.message || '');
}

// webhook_failures RLS grants access only to service_role (internal DLQ table).
// Use the service-role client so enqueue/claim/retry operations are not
// silently denied for the sessionless anon role; fall back to the anon client
// in environments where the service key is not configured (tests/dev).
function dlqDb() {
  return supabaseAdmin || supabase;
}

export const dlqService = {
  /**
   * Enqueue a failed webhook event to the Dead Letter Queue.
   *
   * Idempotent: the payload's event identity (dedupe_key) is unique across the
   * table, so a duplicate provider delivery for the same event is accepted
   * without creating a second DLQ row — and therefore without a second business
   * effect once the row is processed.
   */
  async enqueueFailure(provider, eventType, payload, error) {
    try {
      const permanent = isPermanentFailure(error);
      const { error: insertErr } = await dlqDb()
        .from('webhook_failures')
        .insert({
          provider,
          event_type: eventType,
          payload,
          error_message: sanitizeError(error),
          retry_count: 0,
          next_retry_at: permanent
            ? null
            : new Date(Date.now() + RETRY_BACKOFF[0] * 60000).toISOString(),
          status: permanent ? 'failed_permanently' : 'pending',
          dedupe_key: buildDedupeKey(provider, eventType, payload),
        });

      if (insertErr) {
        if (isUniqueViolation(insertErr)) {
          logger.info(`[DLQ] Duplicate webhook delivery for ${provider} - ${eventType} already queued; ignoring.`);
          return true;
        }
        logger.error(`[DLQ] Failed to enqueue webhook failure: ${insertErr.message}`);
        return false;
      }

      logger.info(
        permanent
          ? `[DLQ] Webhook failure dead-lettered (failed_permanently) for ${provider} - ${eventType}`
          : `[DLQ] Webhook failure enqueued successfully for ${provider} - ${eventType}`,
      );
      return true;
    } catch (err) {
      logger.error(`[DLQ] Critical error enqueueing webhook failure: ${err.message}`);
      return false;
    }
  },

  /**
   * Atomically claim up to `batchSize` eligible rows for this worker.
   *
   * Delegates to the claim_webhook_failure_batch SECURITY DEFINER RPC which uses
   * SELECT ... FOR UPDATE SKIP LOCKED inside a single statement, so multiple API
   * replicas can never claim the same row. Claimed rows become 'processing'
   * with a finite lease owned by this worker.
   */
  async claimBatch({ workerId, batchSize = DEFAULT_BATCH_SIZE, leaseMs = DEFAULT_LEASE_MS, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
    const { data: claimedEvents, error: claimErr } = await dlqDb().rpc('claim_webhook_failure_batch', {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: Math.max(1, Math.floor(leaseMs / 1000)),
      p_max_attempts: maxAttempts,
    });

    if (claimErr) {
      logger.error(`[DLQ] Failed to claim pending events: ${claimErr.message}`);
      return [];
    }
    return claimedEvents || [];
  },

  /**
   * Admit only a live exact attempt using the database clock. Renew before the
   * handler so a queued batch item receives its own processing lease.
   */
  async admitClaim(event, workerId, leaseMs) {
    return this.attemptRpc('admit_webhook_failure_attempt', event.id, workerId, event.attempt_count, {
      p_lease_seconds: Math.max(1, Math.floor(leaseMs / 1000)),
    });
  },

  // Missing/malformed generations never fall back to worker-name-only writes.
  async attemptRpc(name, eventId, workerId, attemptCount, params) {
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) return false;
    try {
      const { data, error } = await dlqDb().rpc(name, {
        p_event_id: eventId, p_worker_id: workerId, p_attempt_count: attemptCount, ...params,
      });
      if (error) {
        logger.error(`[DLQ] ${name} failed for ${eventId}: ${error.message}`);
        return false;
      }
      return data === true;
    } catch (error) {
      logger.error(`[DLQ] ${name} failed for ${eventId}: ${error.message}`);
      return false;
    }
  },

  /** Settlement is atomic on generation and a live database-clock lease. */
  async completeClaim(eventId, workerId, attemptCount) {
    return this.attemptRpc('settle_webhook_failure_attempt', eventId, workerId, attemptCount, {
      p_status: 'resolved', p_retry_count: null, p_next_retry_at: null, p_error_message: null,
    });
  },

  async requeueClaim(eventId, workerId, retryCount, nextRetryAt, error, attemptCount) {
    return this.attemptRpc('settle_webhook_failure_attempt', eventId, workerId, attemptCount, {
      p_status: 'pending', p_retry_count: retryCount, p_next_retry_at: nextRetryAt,
      p_error_message: sanitizeError(error),
    });
  },

  async failClaim(eventId, workerId, finalRetryCount, error, attemptCount) {
    return this.attemptRpc('settle_webhook_failure_attempt', eventId, workerId, attemptCount, {
      p_status: 'failed_permanently', p_retry_count: finalRetryCount, p_next_retry_at: null,
      p_error_message: sanitizeError(error),
    });
  },

  /**
   * Number of rows still awaiting processing (indexed partial count).
   */
  async getBacklogCount() {
    const { count, error } = await dlqDb()
      .from('webhook_failures')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) {
      logger.warn(`[DLQ] Failed to read backlog size: ${error.message}`);
      return null;
    }
    return count ?? 0;
  },

  /**
   * Process pending items in the Dead Letter Queue. Called by the background
   * worker on a fixed interval from every API replica.
   *
   * Crash-safe lifecycle:
   *   pending ─► processing (atomic claim, finite lease)
   *       ┌──────┤
   *       ▼      ├─ success ─────────────► resolved
   *   reclaim     ├─ retryable failure ──► pending (exponential backoff)
   *   (lease       └─ max attempts ───────► failed_permanently
   *    expired)
   *
   * A crashed worker's 'processing' rows are reclaimed by any other replica once
   * the lease expires, and business processors are idempotent so a reclaimed
   * event must rely on the business processor's separate idempotency checks.
   * Admission/settlement cannot cancel an already-started handler after expiry.
   */
  async processQueue(processFnMap, options = {}) {
    const workerId = options.workerId || getWorkerId();
    const batchSize = options.batchSize ?? configuredInt('DLQ_WORKER_BATCH_SIZE', DEFAULT_BATCH_SIZE);
    const leaseMs = options.leaseMs ?? configuredInt('DLQ_WORKER_LEASE_MS', DEFAULT_LEASE_MS);
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    const claimedEvents = await this.claimBatch({ workerId, batchSize, leaseMs, maxAttempts });

    if (claimedEvents.length === 0) {
      await this.logBacklogIfNeeded();
      return { claimed: 0, resolved: 0, retried: 0, failed: 0, lost: 0 };
    }

    logger.info(`[DLQ] Worker ${workerId} claimed ${claimedEvents.length} event(s).`);

    const summary = { claimed: claimedEvents.length, resolved: 0, retried: 0, failed: 0, lost: 0 };

    for (const event of claimedEvents) {
      const admitted = await this.admitClaim(event, workerId, leaseMs);
      if (!admitted) {
        summary.lost += 1;
        logger.warn(`[DLQ] Admission lost for event ${event.id}; handler skipped.`);
        continue;
      }
      const startedAt = Date.now();
      try {
        const handler = processFnMap?.[event.provider];
        if (!handler) {
          throw new Error(`No handler registered for provider: ${event.provider}`);
        }

        await handler(event.event_type, event.payload);

        // Success: resolve only if we still own the claim.
        const owned = await this.completeClaim(event.id, workerId, event.attempt_count);
        if (owned) {
          summary.resolved += 1;
          logger.info(`[DLQ] Successfully resolved DLQ event ${event.id}`);
        } else {
          summary.lost += 1;
          logger.warn(`[DLQ] Event ${event.id} no longer owns a live attempt — completion ignored.`);
        }
      } catch (procErr) {
        const handled = await this.recordFailure(event, workerId, procErr);
        if (handled === 'permanent') {
          summary.failed += 1;
          logger.warn(`[DLQ] Event ${event.id} marked as failed_permanently after ${event.retry_count ?? 0}+1 attempts`);
        } else if (handled === 'retry') {
          summary.retried += 1;
          logger.error(`[DLQ] Retry scheduled for event ${event.id}: ${procErr.message}`);
        } else {
          summary.lost += 1;
          logger.warn(`[DLQ] Event ${event.id} no longer owns a live attempt — retry/failure transition ignored.`);
        }
      }

      const durationMs = Date.now() - startedAt;
      if (durationMs > 1000) {
        logger.warn({ durationMs, eventId: event.id }, `[DLQ] Event ${event.id} processing took ${durationMs}ms`);
      }
    }

    await this.logBacklogIfNeeded();
    return summary;
  },

  /**
   * Decide the fate of a failed claim and persist it (fenced on ownership).
   *
   * @returns {'retry'|'permanent'|'lost'}
   */
  async recordFailure(event, workerId, procErr) {
    const newRetryCount = (event.retry_count ?? 0) + 1;
    const nextBackoffMin = RETRY_BACKOFF[newRetryCount];
    const now = Date.now();

    // Non-retryable failures (malformed payload, order mismatch, replay, …)
    // can never succeed on a retry, so dead-letter them immediately instead of
    // burning retries and delaying operator visibility.
    if (isPermanentFailure(procErr)) {
      const owned = await this.failClaim(event.id, workerId, newRetryCount, procErr, event.attempt_count);
      return owned ? 'permanent' : 'lost';
    }

    if (nextBackoffMin === undefined) {
      const owned = await this.failClaim(event.id, workerId, newRetryCount, procErr, event.attempt_count);
      return owned ? 'permanent' : 'lost';
    }

    const nextRetryAt = new Date(now + nextBackoffMin * 60000).toISOString();
    const owned = await this.requeueClaim(event.id, workerId, newRetryCount, nextRetryAt, procErr, event.attempt_count);
    return owned ? 'retry' : 'lost';
  },

  /**
   * Best-effort backlog visibility. No-op on failure so it can never break the
   * worker cycle.
   */
  async logBacklogIfNeeded() {
    try {
      const backlog = await this.getBacklogCount();
      if (backlog !== null) {
        logger.info(`[DLQ] Backlog of pending webhook failures: ${backlog}`);
      }
    } catch (err) {
      logger.warn(`[DLQ] Backlog metrics unavailable: ${err.message}`);
    }
  },
};
