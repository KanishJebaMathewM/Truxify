import { outboxService } from "../services/outbox/outboxService.js";
import { eventBus } from "../core/events/index.js";
import { BaseEvent } from "../core/events/BaseEvent.js";
import {
  EventMetadata,
  EVENT_SOURCES,
  EVENT_CATEGORIES,
} from "../core/events/EventMetadata.js";
import logger from "../middleware/logger.js";
import { getWorkerId } from "../services/webhook/dlqService.js";

const RELAY_INTERVAL_MS =
  parseInt(process.env.OUTBOX_RELAY_INTERVAL_MS, 10) || 5000;
const MAX_RETRIES = parseInt(process.env.OUTBOX_MAX_RETRIES, 10) || 5;
const CLAIM_BATCH_SIZE =
  parseInt(process.env.OUTBOX_CLAIM_BATCH_SIZE, 10) || 50;
const CLAIM_LEASE_MS =
  parseInt(process.env.OUTBOX_CLAIM_LEASE_MS, 10) || 5 * 60 * 1000;

let _relayTimer = null;
let _relayRun = null;
let _running = false;
let _workerId = null;

async function relayOnce(run) {
  if (_relayRun !== run) return;
  if (_running) return;
  _running = true;

  try {
    await outboxService.deadLetterExhaustedEvents(MAX_RETRIES);

    // Claim due rows; live leases remain exclusive across replicas. Expired
    // claims can be replayed, so external delivery remains at-least-once.
    const events = await outboxService.claimBatch({
      workerId: _workerId,
      batchSize: CLAIM_BATCH_SIZE,
      leaseMs: CLAIM_LEASE_MS,
    });

    for (const event of events) {
      try {
        if (!await outboxService.renewClaim(event.event_id, event.attempts, CLAIM_LEASE_MS)) {
          logger.warn('[OutboxRelay] Skipping event whose claim is no longer current:', { eventId: event.event_id, attempt: event.attempts });
          continue;
        }
        // Publish via eventBus.publishAndReport() with Kafka adapter. Unlike
        // publishAsync(), publishAndReport awaits adapter delivery and reports
        // whether an adapter actually consumed the event, so we only mark the
        // outbox row published when it truly was delivered (issue #11209).
        //
        // emitSafe (called internally by publishAndReport) swallows all
        // listener errors and returns a bare boolean when no listeners are
        // registered, so a plain `await eventBus.emitSafe(...)` can never
        // distinguish a successful publish from a silently-failed one
        // (issue #13582). publishAndReport therefore always resolves to a
        // structured outcome object regardless of emitSafe's boolean/Promise
        // result; the `delivered` gate below is what prevents marking a row
        // published when no adapter actually consumed the event.
        const baseEvent = new BaseEvent({
          eventType: event.event_type,
          payload: {
            aggregateId: event.aggregate_id,
            aggregateType: event.aggregate_type ?? "order",
            ...event.payload,
          },
          metadata: new EventMetadata({
            eventId: event.event_id,
            eventType: event.event_type,
            source: EVENT_SOURCES.INTERNAL,
            category: EVENT_CATEGORIES.DOMAIN,
            timestamp: event.created_at,
          }),
        });
        const outcome = await eventBus.publishAndReport(baseEvent, undefined, {
          adapters: ["kafka"],
          // Database leases govern admission; keep the durable ID on retries
          // without the process-local dedup cache suppressing failed delivery.
          deduplicate: false,
        });

        // Guard explanation:
        // outcome.published       — EventBus successfully received the event
        // !outcome.deduplicated   — Event was not a duplicate (avoid re-marking)
        // outcome.adapterAttempted > 0 — At least one adapter (e.g. Kafka) received the event
        // outcome.adapterFailures === 0 — No adapter reported a failure
        const delivered =
          outcome.published === true &&
          !outcome.deduplicated &&
          outcome.adapterAttempted > 0 &&
          outcome.adapterFailures === 0 &&
          Array.isArray(outcome.adapterErrors) &&
          outcome.adapterErrors.length === 0;

        if (delivered) {
          const settled = await outboxService.markPublished(event.event_id, event.attempts);
          if (!settled) {
            logger.warn('[OutboxRelay] Delivery completed but claim acknowledgement was rejected:', { eventId: event.event_id, attempt: event.attempts });
            continue;
          }
          logger.info("[OutboxRelay] Published event:", {
            eventId: event.event_id,
            type: event.event_type,
          });
        } else {
          const reason = outcome.deduplicated
            ? "Event deduplicated by EventBus"
            : outcome.adapterAttempted === 0
              ? 'No event consumer/adapters handled the event'
              : `Adapter failures: ${outcome.adapterErrors.join('; ')}`;
          const settled = await outboxService.markFailed(event.event_id, _workerId, reason, event.attempts);
          if (!settled) {
            logger.warn('[OutboxRelay] Failed delivery could not settle its claim:', { eventId: event.event_id, attempt: event.attempts });
            continue;
          }
          logger.error('[OutboxRelay] Event not delivered, marked failed:', { eventId: event.event_id, reason });
        }
      } catch (err) {
        logger.error('[OutboxRelay] Failed to publish event:', { eventId: event.event_id, err: err.message });
        try {
          const settled = await outboxService.markFailed(event.event_id, _workerId, err.message, event.attempts);
          if (!settled) logger.warn('[OutboxRelay] Failed delivery could not settle its claim:', { eventId: event.event_id, attempt: event.attempts });
        } catch (markErr) {
          logger.error('[OutboxRelay] Failed to mark event failed:', { eventId: event.event_id, err: markErr.message });
        }
      }
    }
  } catch (err) {
    logger.error("[OutboxRelay] Relay cycle error:", err.message);
  } finally {
    _running = false;
  }
}

export function startOutboxRelayWorker() {
  if (_relayTimer) return;
  const run = {};
  _relayRun = run;
  _workerId = getWorkerId();
  logger.info("[OutboxRelay] Starting outbox relay worker", {
    workerId: _workerId,
  });
  _relayTimer = setInterval(() => relayOnce(run), RELAY_INTERVAL_MS);
  // Run immediately on start
  relayOnce(run);
}

export function stopOutboxRelayWorker() {
  _relayRun = null;
  // Retain _running until an already admitted native cycle actually settles.
  if (_relayTimer) {
    clearInterval(_relayTimer);
    _relayTimer = null;
    logger.info("[OutboxRelay] Outbox relay worker stopped");
  }
}
