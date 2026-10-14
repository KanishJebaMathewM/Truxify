import { outboxService } from "../services/outbox/outboxService.js";
import { eventBus } from "../core/events/index.js";
import { BaseEvent } from "../core/events/BaseEvent.js";
import {
  EVENT_SOURCES,
  EVENT_CATEGORIES,
  EventMetadata,
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
let _running = false;
let _workerId = null;
let _generation = 0;

async function relayOnce() {
  if (_running) return;
  _running = true;

  try {

    // Atomically claim a batch for THIS replica only. claim_outbox_batch uses
    // SELECT ... FOR UPDATE SKIP LOCKED, so two replicas can never claim the
    // same row. This is the cross-process claim lock that prevents each event
    // from being published more than once to Kafka across replicas (#14680).
    const events = await outboxService.claimBatch({
      workerId: _workerId,
      batchSize: CLAIM_BATCH_SIZE,
      leaseMs: CLAIM_LEASE_MS,
    });

    // Maintenance (dead-lettering + requeueing expired failures) only runs
    // on idle cycles — never reset claims while a live batch is in flight.
    if (events.length === 0) {
      await outboxService.deadLetterExhaustedEvents(MAX_RETRIES);
      await outboxService.requeueFailedEvents(MAX_RETRIES);
    }

    for (const event of events) {
      // Hoisted above the try so the catch path can reference it (a const
      // declared inside try is block-scoped and invisible to catch).
      const eventId = event.event_id || event.id;
      try {
        // Claim fencing: renew the lease before dispatching — a rejected
        // renewal means another replica owns this event now; skip dispatch
        // and settlement entirely.
        const renewed = await outboxService.renewClaim(event.event_id, event.attempts);
        if (!renewed) {
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
        // Carry the outbox row's event_id so the Kafka record is
        // traceable to — and idempotent against — the outbox entry.
        const baseEvent = new BaseEvent({
          metadata: new EventMetadata({ eventId }),
          eventType: event.event_type,
          payload: {
            aggregateId: event.aggregate_id,
            aggregateType: event.aggregate_type ?? "order",
            ...event.payload,
          },
          source: EVENT_SOURCES.INTERNAL,
          category: EVENT_CATEGORIES.DOMAIN,
        });
        const outcome = await eventBus.publishAndReport(baseEvent, undefined, {
          adapters: ["kafka"],
          // The outbox row IS the dedup record — adapter-level dedup keys off
          // the event id would double-guard and hide redeliveries.
          deduplicate: false,
        });

        const noAdapterFailure =
          outcome?.adapterFailures === 0 &&
          (!outcome.adapterErrors ||
            (Array.isArray(outcome.adapterErrors) &&
              outcome.adapterErrors.length === 0));

        const delivered =
          Boolean(outcome) &&
          outcome.published === true &&
          !outcome.deduplicated &&
          outcome.adapterAttempted > 0 &&
          noAdapterFailure;

        if (delivered) {
          const settled = await outboxService.markPublished(
            eventId,
            event.attempts
          );

          if (!settled) {
            logger.warn(
              "[OutboxRelay] Delivery completed but claim acknowledgement was rejected:",
              {
                eventId: event.event_id,
                attempt: event.attempts,
              }
            );
            continue;
          }

          logger.info("[OutboxRelay] Published event:", {
            eventId,
            type: event.event_type,
          });
        } else {
          const reason = !outcome
            ? "No outcome returned from EventBus"
            : outcome.deduplicated
              ? "Event deduplicated by EventBus"
              : outcome.published !== true
                ? "Publish outcome was unsuccessful"
                : outcome.adapterAttempted === 0
                  ? "No event consumer/adapters handled the event"
                  : `Adapter failures: ${
                      Array.isArray(outcome.adapterErrors) &&
                      outcome.adapterErrors.length > 0
                        ? outcome.adapterErrors.join("; ")
                        : "Adapter reported failure"
                    }`;

          const settled = await outboxService.markFailed(
            eventId,
            _workerId,
            reason,
            event.attempts
          );

          if (!settled) {
            logger.warn(
              "[OutboxRelay] Failed delivery could not settle its claim:",
              {
                eventId: event.event_id,
                attempt: event.attempts,
              }
            );
            continue;
          }

          logger.error("[OutboxRelay] Event not delivered, marked failed:", {
            eventId: event.event_id,
            reason,
          });
        }
      } catch (err) {
        logger.error("[OutboxRelay] Failed to publish event:", {
          eventId,
          err: err.message,
        });

        try {
          const settled = await outboxService.markFailed(
            eventId,
            _workerId,
            err.message,
            event.attempts
          );

          if (!settled) {
            logger.warn(
              "[OutboxRelay] Failed delivery could not settle its claim:",
              {
                eventId: event.event_id,
                attempt: event.attempts,
              }
            );
          }
        } catch (markErr) {
          if (process.env.PROBE_RELAY) console.log('PROBE-MARKERR:', markErr.message, markErr.stack?.split('\n')[1]?.trim());
          logger.error("[OutboxRelay] Failed to mark event failed:", {
            eventId: event.event_id || event.id,
            err: markErr.message,
          });
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
  _workerId = getWorkerId();
  logger.info("[OutboxRelay] Starting outbox relay worker", {
    workerId: _workerId,
  });
  // Generation fencing: a captured interval callback from a stopped
  // generation must never claim a batch for the restarted worker.
  const generation = ++_generation;
  _relayTimer = setInterval(() => {
    if (generation !== _generation) return;
    void relayOnce();
  }, RELAY_INTERVAL_MS);
  // Run immediately on start — the first interval tick is RELAY_INTERVAL_MS
  // away, and workers are expected to drain pending events at boot.
  void relayOnce();
  // Run immediately on start
  relayOnce();
}

export function stopOutboxRelayWorker() {
  _generation++;
  if (_relayTimer) {
    clearInterval(_relayTimer);
    _relayTimer = null;
    logger.info("[OutboxRelay] Outbox relay worker stopped");
  }
}

