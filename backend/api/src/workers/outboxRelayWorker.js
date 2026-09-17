import { outboxService } from '../services/outbox/outboxService.js';
import { eventBus } from '../core/events/index.js';
import { BaseEvent } from '../core/events/BaseEvent.js';
import { EVENT_SOURCES, EVENT_CATEGORIES } from '../core/events/EventMetadata.js';
import logger from '../middleware/logger.js';
import { getWorkerId } from '../services/webhook/dlqService.js';

const RELAY_INTERVAL_MS = parseInt(process.env.OUTBOX_RELAY_INTERVAL_MS, 10) || 5000;
const MAX_RETRIES = parseInt(process.env.OUTBOX_MAX_RETRIES, 10) || 5;
const CLAIM_BATCH_SIZE = parseInt(process.env.OUTBOX_CLAIM_BATCH_SIZE, 10) || 50;
const CLAIM_LEASE_MS = parseInt(process.env.OUTBOX_CLAIM_LEASE_MS, 10) || 5 * 60 * 1000;

let _relayTimer = null;
let _running = false;
let _workerId = null;

async function relayOnce() {
  if (_running) return;
  _running = true;

  try {
    await outboxService.deadLetterExhaustedEvents(MAX_RETRIES);
    await outboxService.requeueFailedEvents(MAX_RETRIES);

    // Atomically claim a batch for THIS replica only. claim_outbox_batch uses
    // SELECT ... FOR UPDATE SKIP LOCKED, so two replicas can never claim the
    // same row. This is the cross-process claim lock that prevents each event
    // from being published more than once to Kafka across replicas (#14680).
    const events = await outboxService.claimBatch({
      workerId: _workerId,
      batchSize: CLAIM_BATCH_SIZE,
      leaseMs: CLAIM_LEASE_MS,
    });

    for (const event of events) {
      try {
        // Publish via eventBus.publishAndReport() with Kafka adapter. Unlike
        // publishAsync(), publishAndReport awaits adapter delivery and reports
        // whether an adapter actually consumed the event, so we only mark the
        // outbox row published when it truly was delivered (issue #11209).
        const baseEvent = new BaseEvent({
          eventType: event.event_type,
          payload: {
            aggregateId: event.aggregate_id,
            aggregateType: event.aggregate_type ?? 'order',
            ...event.payload,
          },
          source: EVENT_SOURCES.INTERNAL,
          category: EVENT_CATEGORIES.DOMAIN,
        });
        const outcome = await eventBus.publishAndReport(baseEvent, undefined, { adapters: ['kafka'] });

        // Guard explanation:
        // outcome.published       — EventBus successfully received the event
        // !outcome.deduplicated   — Event was not a duplicate (avoid re-marking)
        // outcome.adapterAttempted > 0 — At least one adapter (e.g. Kafka) received the event
        // outcome.adapterFailures === 0 — No adapter reported a failure
        const delivered =
          outcome.published &&
          !outcome.deduplicated &&
          outcome.adapterAttempted > 0 &&
          outcome.adapterFailures === 0;

        if (delivered) {
          await outboxService.markPublished(event.event_id);
          logger.info('[OutboxRelay] Published event:', { eventId: event.event_id, type: event.event_type });
        } else {
          const reason = outcome.deduplicated
            ? 'Event deduplicated by EventBus'
            : outcome.adapterAttempted === 0
              ? 'No event consumer/adapters handled the event'
              : `Adapter failures: ${outcome.adapterErrors.join('; ')}`;
          await outboxService.markFailed(event.event_id, reason);
          logger.error('[OutboxRelay] Event not delivered, marked failed:', { eventId: event.event_id, reason });
        }
      } catch (err) {
        logger.error('[OutboxRelay] Failed to publish event:', { eventId: event.id, err: err.message });
        try {
          await outboxService.markFailed(event.id, err.message);
        } catch (markErr) {
          logger.error('[OutboxRelay] Failed to mark event failed:', { eventId: event.id, err: markErr.message });
        }
      }
    }
  } catch (err) {
    logger.error('[OutboxRelay] Relay cycle error:', err.message);
  } finally {
    _running = false;
  }
}

export function startOutboxRelayWorker() {
  if (_relayTimer) return;
  _workerId = getWorkerId();
  logger.info('[OutboxRelay] Starting outbox relay worker', { workerId: _workerId });
  _relayTimer = setInterval(relayOnce, RELAY_INTERVAL_MS);
  // Run immediately on start
  relayOnce();
}

export function stopOutboxRelayWorker() {
  if (_relayTimer) {
    clearInterval(_relayTimer);
    _relayTimer = null;
    logger.info('[OutboxRelay] Outbox relay worker stopped');
  }
}