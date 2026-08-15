/**
 * Transactional outbox relay.
 *
 * Polls `order_outbox` rows that are committed but not yet published to Kafka,
 * publishes each one, and only then marks it published. Kafka being down never
 * loses an event — it only delays publication (the row is failed with an
 * exponential backoff and re-claimed on the next cycle).
 *
 * Lifecycle of a row (see supabase/migrations/20260812000000_order_outbox.sql):
 *   unpublished ─► claimed (atomic claim, finite lease, SKIP LOCKED)
 *       ┌───────┤
 *       ▼       ├─ publish + mark ──────► published
 *   reclaim      └─ publish failed ──────► unpublished (attempts++, backoff)
 *   (lease
 *    expired)
 *
 * The relay is idempotent-safe: if a crash happens after publish but before
 * mark, the next cycle re-publishes the same event. Downstream consumers dedupe
 * on (topic, event_id) via kafka_processed_events, so side effects are applied
 * exactly once.
 *
 * Run standalone:  node relay/outboxRelay.js
 * Run in-process:  import { startOutboxRelay } from './relay/outboxRelay.js'
 */
import os from 'os';
import { pathToFileURL } from 'url';
import { supabase, supabaseAdmin } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';
import kafka from '../config/kafka.config.js';
import { ContextPropagator } from '../../api/src/core/telemetry/ContextPropagator.js';
import { WorkerTracer } from '../../api/src/core/telemetry/WorkerTracer.js';

const DEFAULT_INTERVAL_MS = 5 * 1000;
const DEFAULT_BATCH_SIZE = 100;
// Lease must be comfortably longer than one processing cycle yet finite so a
// crashed relay's claims are reclaimed quickly.
const DEFAULT_LEASE_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 15;
const BACKLOG_LOG_INTERVAL_MS = 60 * 1000;

let intervalId = null;
// In-process guard preventing overlapping cycles within THIS process. It is NOT
// the distributed coordination mechanism — cross-replica exclusivity is
// provided by the database-level lease claim (claim_order_outbox_events).
let cycleRunning = false;
let lastBacklogLogAt = 0;

function configuredInt(envName, fallback) {
  const raw = process.env[envName];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Stable, per-process worker identity used for claim ownership (claimed_by),
 * lease-reclaim fencing, debugging, and telemetry.
 */
export function getWorkerId() {
  return `${process.env.HOSTNAME || os.hostname()}-${process.pid}`;
}

// order_outbox RLS grants access only to service_role (internal outbox table).
// Use the service-role client so claim/mark/fail RPCs are not silently denied
// for the sessionless anon role; fall back to the anon client in environments
// where the service key is not configured (tests/dev).
function outboxDb() {
  return supabaseAdmin || supabase;
}

/**
 * Atomically claim up to `limit` eligible rows for this relay instance.
 * Delegates to the claim_order_outbox_events SECURITY DEFINER RPC which uses
 * SELECT ... FOR UPDATE SKIP LOCKED, so multiple relay replicas can never claim
 * the same row. Claimed rows carry a finite lease owned by this instance.
 */
export async function claimBatch({
  limit = DEFAULT_BATCH_SIZE,
  instanceId,
  leaseMs = DEFAULT_LEASE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  const { data: claimedEvents, error: claimErr } = await outboxDb().rpc(
    'claim_order_outbox_events',
    {
      p_limit: limit,
      p_instance_id: instanceId || getWorkerId(),
      p_lease_seconds: Math.max(1, Math.floor(leaseMs / 1000)),
      p_max_attempts: maxAttempts,
    },
  );

  if (claimErr) {
    logger.error(`[OutboxRelay] Failed to claim pending outbox events: ${claimErr.message}`);
    return [];
  }
  return claimedEvents || [];
}

/**
 * Mark an outbox row published. Only matches rows still unpublished, so a
 * duplicate mark (e.g. after a lease re-claim) is a no-op.
 *
 * @returns {Promise<boolean>} true when this call performed the transition.
 */
export async function markPublished(eventId) {
  const { data, error } = await outboxDb().rpc('mark_order_outbox_published', {
    p_event_id: eventId,
  });
  if (error) {
    logger.error(`[OutboxRelay] Failed to mark outbox event ${eventId} published: ${error.message}`);
    return false;
  }
  return Boolean(data);
}

/**
 * Record a publish failure: increments attempts, schedules the next attempt via
 * exponential backoff (capped by the DB), and clears the lease so the row can
 * be re-claimed.
 *
 * @returns {Promise<boolean>} true when the failure was recorded.
 */
export async function failEvent(eventId, error) {
  const { data, error: failErr } = await outboxDb().rpc('fail_order_outbox_event', {
    p_event_id: eventId,
    p_error: String((error && error.message) || error || 'unknown error').slice(0, 2000),
  });
  if (failErr) {
    logger.error(`[OutboxRelay] Failed to record failure for outbox event ${eventId}: ${failErr.message}`);
    return false;
  }
  return Boolean(data);
}

/**
 * Number of rows still awaiting publication (indexed partial count).
 */
export async function getBacklogCount() {
  const { count, error } = await outboxDb()
    .from('order_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('published', false);

  if (error) {
    logger.warn(`[OutboxRelay] Failed to read outbox backlog size: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

/**
 * Build the Kafka message value for an outbox row in the canonical event shape
 * (metadata + payload) used by order.events.js, with the trace context from the
 * active worker span injected into metadata for end-to-end tracing.
 */
export function buildKafkaMessage(row) {
  return ContextPropagator.injectIntoEventPayload({
    metadata: row.metadata || null,
    payload: row.payload || {},
  });
}

/**
 * Publish one outbox row to Kafka. The Kafka message key is the outbox
 * event_id, which consumers use as the idempotency key (topic, event_id).
 */
export async function publishOutboxRow(row) {
  await kafka.publishEvent(row.topic, buildKafkaMessage(row), row.event_id);
  logger.info(`[OutboxRelay] Published outbox event ${row.event_id} -> ${row.topic}`);
}

/**
 * Run a single relay cycle: claim the next batch, publish each event to Kafka,
 * then mark it published. Publish failures are recorded via fail_order_outbox_event
 * so the row retries with backoff instead of being dropped.
 *
 * @returns {Promise<{claimed: number, published: number, failed: number}>}
 */
export async function processOutboxCycle(options = {}) {
  const claimed = await claimBatch({
    limit: options.limit,
    instanceId: options.instanceId,
    leaseMs: options.leaseMs,
    maxAttempts: options.maxAttempts,
  });

  if (claimed.length === 0) {
    await logBacklogIfNeeded();
    return { claimed: 0, published: 0, failed: 0 };
  }

  logger.info(`[OutboxRelay] Worker ${getWorkerId()} claimed ${claimed.length} outbox event(s).`);

  const summary = { claimed: claimed.length, published: 0, failed: 0 };

  for (const row of claimed) {
    try {
      await publishOutboxRow(row);

      const marked = await markPublished(row.event_id);
      if (marked) {
        summary.published += 1;
      } else {
        // Already published by another relay (lease re-claim) — nothing to do.
        logger.warn(
          `[OutboxRelay] Outbox event ${row.event_id} was already marked published by another relay — skipped.`,
        );
      }
    } catch (publishErr) {
      summary.failed += 1;
      const recorded = await failEvent(row.event_id, publishErr);
      logger.error(
        `[OutboxRelay] Failed to publish outbox event ${row.event_id} (${row.topic}): ${publishErr.message}` +
          (recorded ? '' : ' (failure NOT recorded)'),
      );
    }
  }

  await logBacklogIfNeeded();
  return summary;
}

/**
 * Throttled best-effort backlog visibility. No-op on failure so it can never
 * break the relay cycle.
 */
async function logBacklogIfNeeded() {
  const now = Date.now();
  if (now - lastBacklogLogAt < BACKLOG_LOG_INTERVAL_MS) return;
  lastBacklogLogAt = now;

  try {
    const backlog = await getBacklogCount();
    if (backlog !== null) {
      logger.info(`[OutboxRelay] Backlog of unpublished outbox events: ${backlog}`);
    }
  } catch (err) {
    logger.warn(`[OutboxRelay] Backlog metrics unavailable: ${err.message}`);
  }
}

/**
 * Start the polling relay. Safe to call from every API/kafka replica: the claim
 * RPC's SKIP LOCKED lease guarantees each event is published exactly once.
 */
export const startOutboxRelay = () => {
  if (intervalId) return;

  const intervalMs = configuredInt('OUTBOX_RELAY_INTERVAL_MS', DEFAULT_INTERVAL_MS);

  const tracedHandler = WorkerTracer.wrapIntervalWorker('order-outbox-relay', async () => {
    if (cycleRunning) {
      logger.warn('[OutboxRelay] Previous cycle still running — skipping overlapping interval.');
      return;
    }
    cycleRunning = true;
    try {
      await processOutboxCycle();
    } finally {
      cycleRunning = false;
    }
  }, { intervalMs });

  intervalId = setInterval(async () => {
    try {
      await tracedHandler();
    } catch (err) {
      // A failing cycle must never crash the process; the next interval will
      // retry. The claim is idempotent across relays, so events are never lost.
      logger.error(`[OutboxRelay] Error in polling loop: ${err.message}`);
    }
  }, intervalMs);

  logger.info(`[OutboxRelay] Started transactional outbox relay (every ${intervalMs}ms).`);
};

export const stopOutboxRelay = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    cycleRunning = false;
    logger.info('[OutboxRelay] Stopped transactional outbox relay.');
  }
};

/**
 * Standalone entrypoint: connect Kafka, start the relay, and shut down cleanly
 * on SIGTERM/SIGINT.
 */
export async function main() {
  try {
    await kafka.connect();
    startOutboxRelay();
    logger.info('[OutboxRelay] Standalone outbox relay running.');
  } catch (error) {
    logger.error('[OutboxRelay] Failed to start: ', error);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const shutdown = async () => {
    stopOutboxRelay();
    await kafka.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  main();
}
