import { dlqService } from '../services/webhook/dlqService.js';
import logger from '../middleware/logger.js';

// Import our handlers
// Currently we only have a placeholder for escrow, but we map it here
const processFnMap = {
  'escrow': async (eventType, payload) => {
    logger.info(`[DLQ Worker] Processing escrow event ${eventType}...`);
    // Placeholder logic for retrying an escrow webhook event
    if (eventType === 'EscrowRefunded') {
      // Simulate processing
      logger.info(`[DLQ Worker] Simulating EscrowRefunded processing for order: ${payload.orderId}`);
    } else {
      throw new Error(`Unhandled escrow event type in DLQ worker: ${eventType}`);
    }
  }
};

let intervalId = null;

export const startDlqWorker = () => {
  if (intervalId) return;

  const INTERVAL_MS = 60 * 1000; // Poll every 1 minute

  intervalId = setInterval(async () => {
    try {
      await dlqService.processQueue(processFnMap);
    } catch (err) {
      logger.error(`[DLQ Worker] Error in polling loop: ${err.message}`);
    }
  }, INTERVAL_MS);

  logger.info('[DLQ Worker] Started Dead Letter Queue polling worker.');
};

export const stopDlqWorker = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[DLQ Worker] Stopped Dead Letter Queue polling worker.');
  }
};
