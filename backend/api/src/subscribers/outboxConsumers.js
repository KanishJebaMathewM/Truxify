import logger from '../middleware/logger.js';
import { supabaseAdmin } from '../config/db.js';

/**
 * Checks and records consumer idempotency to prevent duplicate executions.
 * 
 * @param {string} eventId
 * @param {string} consumerName
 * @returns {Promise<boolean>} True if this is the first time the event is being processed by this consumer
 */
export async function claimConsumerIdempotency(eventId, consumerName) {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    return true;
  }

  try {
    const { error } = await supabaseAdmin
      .from('processed_domain_events')
      .insert({
        event_id: eventId,
        consumer_name: consumerName,
        processed_at: new Date().toISOString(),
      });

    if (error) {
      if (error.code === '23505') {
        // Unique violation: already processed by this consumer
        logger.debug({ eventId, consumerName }, '[OutboxConsumers] Duplicate event skipped by consumer');
        return false;
      }
      logger.warn({ error, eventId, consumerName }, '[OutboxConsumers] Idempotency record error');
    }

    return true;
  } catch (err) {
    logger.warn({ err, eventId, consumerName }, '[OutboxConsumers] Idempotency check exception');
    return true;
  }
}

/**
 * 1. Notification Dispatch Consumer (Push / SMS)
 */
export async function handleNotificationEvent(event) {
  const isFirstTime = await claimConsumerIdempotency(event.id, 'NOTIFICATION_DISPATCHER');
  if (!isFirstTime) return;

  const { event_type, payload } = event;
  logger.info({ eventType: event_type, orderId: payload.orderId }, '[NotificationConsumer] Dispatching push notification');

  // Push notification formatting based on event type
  switch (event_type) {
    case 'ORDER_MATCHED':
      logger.debug({ orderId: payload.orderId, driverId: payload.driverId }, 'Notification: Driver assigned to your shipment');
      break;
    case 'ORDER_IN_TRANSIT':
      logger.debug({ orderId: payload.orderId }, 'Notification: Your freight is now in transit');
      break;
    case 'ORDER_DELIVERED':
      logger.debug({ orderId: payload.orderId }, 'Notification: Shipment successfully delivered and verified');
      break;
    case 'ORDER_SETTLED':
      logger.debug({ orderId: payload.orderId }, 'Notification: Payout settled to driver wallet');
      break;
    default:
      break;
  }
}

/**
 * 2. Analytics & ML Telemetry Consumer
 */
export async function handleAnalyticsEvent(event) {
  const isFirstTime = await claimConsumerIdempotency(event.id, 'ML_ANALYTICS_INDEXER');
  if (!isFirstTime) return;

  const { event_type, payload } = event;
  logger.info({ eventType: event_type, orderId: payload.orderId }, '[AnalyticsConsumer] Indexing event into ML pipeline');
}

/**
 * 3. Blockchain Escrow Trigger Consumer
 */
export async function handleBlockchainEscrowEvent(event) {
  const isFirstTime = await claimConsumerIdempotency(event.id, 'BLOCKCHAIN_ESCROW_RELAYER');
  if (!isFirstTime) return;

  const { event_type, payload } = event;

  if (event_type === 'ORDER_DELIVERED') {
    logger.info(
      { orderId: payload.orderId, otpVerified: payload.deliveryOtpVerified },
      '[BlockchainEscrowConsumer] Triggering Polygon smart contract milestone payout release'
    );
  }
}

/**
 * Helper to register all standard outbox subscribers to a worker.
 * 
 * @param {object} worker - OutboxPublisherWorker instance
 */
export function registerAllOutboxConsumers(worker) {
  worker.subscribe('*', handleNotificationEvent);
  worker.subscribe('*', handleAnalyticsEvent);
  worker.subscribe('ORDER_DELIVERED', handleBlockchainEscrowEvent);
  logger.info('[OutboxConsumers] Registered all outbox event subscribers');
}

export default {
  claimConsumerIdempotency,
  handleNotificationEvent,
  handleAnalyticsEvent,
  handleBlockchainEscrowEvent,
  registerAllOutboxConsumers,
};
