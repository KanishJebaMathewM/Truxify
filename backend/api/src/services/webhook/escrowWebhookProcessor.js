import logger from '../../middleware/logger.js';

export async function processEscrowWebhookEvent(eventType, payload = {}) {
  if (!eventType) {
    throw new Error('Missing escrow webhook event type');
  }

  const orderId = payload.orderId || 'unknown';
  logger.info(`[Webhook] Processing escrow event ${eventType} for order ${orderId}`);

  if (payload.simulateFailure === true) {
    throw new Error('Simulated database lock or processing failure');
  }

  return { received: true };
}
