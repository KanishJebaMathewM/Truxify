import logger from '../middleware/logger.js';
import { eventBus } from '../core/events/index.js';
import { BaseEvent } from '../core/events/BaseEvent.js';
import { EventMetadata } from '../core/events/EventMetadata.js';
import { outboxService } from '../services/outbox/outboxService.js';
import { getWorkerId } from '../services/webhook/dlqService.js';

const DEFAULT_RELAY_INTERVAL_MS = 5000;
const _workerId = getWorkerId();

let _relayTimer = null;
let _relayGeneration = 0;
let _cycleRunning = false;

/**
 * One relay cycle: dead-letter exhausted events, claim a leased batch, renew
 * each claim before dispatch, publish, and settle. `generation` fences the
 * cycle against stopOutboxRelayWorker(): a captured interval callback or an
 * in-flight cycle from a previous generation can never claim or settle.
 */
async function runRelayCycle(generation) {
  if (generation !== _relayGeneration || _cycleRunning) {
    return;
  }
  _cycleRunning = true;
  try {
    await outboxService.deadLetterExhaustedEvents();

    const events = await outboxService.claimBatch();
    for (const rawEvent of events) {
      if (generation !== _relayGeneration) {
        return;
      }

      // Normalize the durable id: leased-claim rows may carry `event_id` or
      // the legacy `id` key, and every downstream log and settlement reads
      // `event.event_id`.
      const event = { ...rawEvent, event_id: rawEvent.event_id ?? rawEvent.id };
      const eventId = event.event_id;

      try {
        if (!(await outboxService.renewClaim(eventId, event.attempts))) {
          logger.warn(
            "[OutboxRelay] Claim renewal rejected; skipping dispatch:",
            { eventId, attempt: event.attempts },
          );
          continue;
        }

        const outcome = await eventBus.publishAndReport(
          new BaseEvent({
            eventType: event.event_type,
            payload: event.payload ?? {},
            metadata: new EventMetadata({
              eventId,
              eventType: event.event_type,
            }),
          }),
          undefined,
          { adapters: ["kafka"], deduplicate: false },
        );

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
            event.event_id,
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
            event.event_id,
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
          eventId: event.event_id || event.id,
          err: err.message,
        });

        try {
          const settled = await outboxService.markFailed(
            event.event_id,
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
          logger.error("[OutboxRelay] Failed to mark event failed:", {
            eventId: event.event_id || event.id,
            err: markErr.message,
          });
        }
      }
    }
  } catch (err) {
    logger.error("[OutboxRelay] Relay cycle failed:", { err: err.message });
  } finally {
    _cycleRunning = false;
  }
}

export function startOutboxRelayWorker() {
  if (_relayTimer) {
    return;
  }

  const configuredInterval = Number(process.env.OUTBOX_RELAY_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(configuredInterval) && configuredInterval > 0
      ? configuredInterval
      : DEFAULT_RELAY_INTERVAL_MS;

  _relayGeneration += 1;
  const generation = _relayGeneration;

  void runRelayCycle(generation);
  _relayTimer = setInterval(() => {
    void runRelayCycle(generation);
  }, intervalMs);

  logger.info(`[OutboxRelay] Started outbox relay worker (every ${intervalMs}ms).`);
}

export function stopOutboxRelayWorker() {
  if (_relayTimer) {
    clearInterval(_relayTimer);
    _relayTimer = null;
  }
  // Invalidate the current generation so a captured interval callback or an
  // in-flight cycle can never dispatch or settle claims after the stop.
  _relayGeneration += 1;
  logger.info("[OutboxRelay] Stopped outbox relay worker.");
}
