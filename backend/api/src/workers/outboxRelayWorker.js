import { outboxService } from '../services/outbox/outboxService.js';
import { eventBus } from '../core/events/index.js';
import { BaseEvent } from '../core/events/BaseEvent.js';
import { EVENT_SOURCES, EVENT_CATEGORIES } from '../core/events/EventMetadata.js';
import logger from '../middleware/logger.js';

const RELAY_INTERVAL_MS = parseInt(process.env.OUTBOX_RELAY_INTERVAL_MS, 10) || 5000;
const MAX_RETRIES = parseInt(process.env.OUTBOX_MAX_RETRIES, 10) || 5;

let _relayTimer = null;
let _running = false;

async function relayOnce() {
  if (_running) return;
  _running = true;

  try {
    await outboxService.requeueFailedEvents(MAX_RETRIES);
    const events = await outboxService.fetchPendingEvents(50);

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
            aggregateType: event.aggregate_type,
            ...event.payload,
          },
          source: EVENT_SOURCES.INTERNAL,
          category: EVENT_CATEGORIES.DOMAIN,
        });
        const outcome = await eventBus.publishAndReport(baseEvent, { adapters: ['kafka'] });

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
          await outboxService.markPublished(event.id);
          logger.info('[OutboxRelay] Published event:', { eventId: event.id, type: event.event_type });
        } else {
          const reason = outcome.deduplicated
            ? 'Event deduplicated by EventBus'
            : outcome.adapterAttempted === 0
              ? 'No event consumer/adapters handled the event'
              : `Adapter failures: ${outcome.adapterErrors.join('; ')}`;
          await outboxService.markFailed(event.id, reason);
          logger.error('[OutboxRelay] Event not delivered, marked failed:', { eventId: event.id, reason });
        }
      } catch (err) {
        logger.error('[OutboxRelay] Failed to publish event:', { eventId: event.id, err: err.message });
        await outboxService.markFailed(event.id, err.message);
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
  logger.info('[OutboxRelay] Starting outbox relay worker');
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