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
  const message = typeof error === 'string' ? error : (error.message || String(error));
  return message.slice(0, 1000);
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
      const { error: insertErr } = await dlqDb()
        .from('webhook_failures')
        .insert({
          provider,
          event_type: eventType,
          payload,
          error_message: sanitizeError(error),
          retry_count: 0,
          next_retry_at: new Date(Date.now() + RETRY_BACKOFF[0] * 60000).toISOString(),
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

      logger.info(`[DLQ] Webhook failure enqueued successfully for ${provider} - ${eventType}`);
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
   * Fenced completion: only the worker that currently owns a 'processing' row
   * (matching claimed_by) with an unexpired lease may resolve it. If another
   * replica reclaimed the row after lease expiry, the update matches zero rows
   * and this worker loses ownership.
   */
  async completeClaim(eventId, workerId) {
    const now = new Date().toISOString();
    const { data: completed, error } = await dlqDb()
      .from('webhook_failures')
      .update({
        status: 'resolved',
        resolved_at: now,
        error_message: null,
        updated_at: now,
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
      })
      .eq('id', eventId)
      .eq('status', 'processing')
      .eq('claimed_by', workerId)
      .select('id');

    if (error) {
      logger.error(`[DLQ] Failed to mark event ${eventId} as resolved: ${error.message}`);
      return false;
    }
    return Boolean(completed && completed.length > 0);
  },

  /**
   * Fenced retryable-failure transition: processing -> pending with an
   * incremented retry_count, next_retry_at from the exponential backoff, and
   * cleared claim/lease metadata.
   */
  async requeueClaim(eventId, workerId, retryCount, nextRetryAt, error) {
    const now = new Date().toISOString();
    const { data: requeued, error: updateErr } = await dlqDb()
      .from('webhook_failures')
      .update({
        status: 'pending',
        retry_count: retryCount,
        next_retry_at: nextRetryAt,
        error_message: sanitizeError(error),
        updated_at: now,
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
      })
      .eq('id', eventId)
      .eq('status', 'processing')
      .eq('claimed_by', workerId)
      .select('id');

    if (updateErr) {
      logger.error(`[DLQ] Failed to requeue event ${eventId} for retry: ${updateErr.message}`);
      return false;
    }
    return Boolean(requeued && requeued.length > 0);
  },

  /**
   * Fenced permanent-failure transition: processing -> failed_permanently.
   */
  async failClaim(eventId, workerId, finalRetryCount, error) {
    const now = new Date().toISOString();
    const { data: failed, error: updateErr } = await dlqDb()
      .from('webhook_failures')
      .update({
        status: 'failed_permanently',
        retry_count: finalRetryCount,
        error_message: sanitizeError(error),
        updated_at: now,
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
      })
      .eq('id', eventId)
      .eq('status', 'processing')
      .eq('claimed_by', workerId)
      .select('id');

    if (updateErr) {
      logger.error(`[DLQ] Failed to mark event ${eventId} as failed_permanently: ${updateErr.message}`);
      return false;
    }
    return Boolean(failed && failed.length > 0);
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
   * event cannot apply its side effects twice.
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
      const startedAt = Date.now();
      try {
        const handler = processFnMap?.[event.provider];
        if (!handler) {
          throw new Error(`No handler registered for provider: ${event.provider}`);
        }

        await handler(event.event_type, event.payload);

        // Success: resolve only if we still own the claim.
        const owned = await this.completeClaim(event.id, workerId);
        if (owned) {
          summary.resolved += 1;
          logger.info(`[DLQ] Successfully resolved DLQ event ${event.id}`);
        } else {
          summary.lost += 1;
          logger.warn(`[DLQ] Event ${event.id} reclaimed by another worker — completion ignored (idempotency preserved).`);
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
          logger.warn(`[DLQ] Event ${event.id} reclaimed by another worker — retry/failure transition ignored.`);
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

    if (nextBackoffMin === undefined) {
      const owned = await this.failClaim(event.id, workerId, newRetryCount, procErr);
      return owned ? 'permanent' : 'lost';
    }

    const nextRetryAt = new Date(now + nextBackoffMin * 60000).toISOString();
    const owned = await this.requeueClaim(event.id, workerId, newRetryCount, nextRetryAt, procErr);
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
        } catch (procErr) {
          logger.error(`[DLQ] Retry failed for event ${event.id}: ${procErr.message}`);

          const newRetryCount = (event.retry_count ?? 0) + 1;
          const nextBackoffMin = RETRY_BACKOFF[newRetryCount] || -1;

          if (nextBackoffMin === -1) {
            // Failed permanently
            await dlqDb()
              .from('webhook_failures')
              .update({ 
                status: 'failed_permanently', 
                error_message: String(procErr.message || procErr).slice(0, 1000),
                updated_at: new Date().toISOString()
              })
              .eq('id', event.id);
            logger.warn(`[DLQ] Event ${event.id} marked as failed_permanently`);
          } else {
            // Schedule next retry by resetting status to pending so the event can be re-claimed.
            const nextRetryAt = new Date(Date.now() + nextBackoffMin * 60000).toISOString();
            await dlqDb()
              .from('webhook_failures')
              .update({
                status: 'pending',
                retry_count: newRetryCount,
                next_retry_at: nextRetryAt,
                error_message: String(procErr.message || procErr).slice(0, 1000),
                updated_at: new Date().toISOString(),
              })
              .eq('id', event.id);
          }
        }
      }
    } catch (err) {
      logger.warn(`[DLQ] Backlog metrics unavailable: ${err.message}`);
    }
  },
};
