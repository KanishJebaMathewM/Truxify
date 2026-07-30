import { dlqService } from '../services/webhook/dlqService.js';
import logger from '../middleware/logger.js';
import { processEscrowWebhookEvent } from '../services/webhook/escrowWebhookProcessor.js';
import { WorkerTracer } from '../core/telemetry/WorkerTracer.js';

const processFnMap = {
  escrow: processEscrowWebhookEvent,
};

let intervalId = null;

export const startDlqWorker = () => {
  if (intervalId) return;

  const INTERVAL_MS = 60 * 1000; // Poll every 1 minute

  const tracedHandler = WorkerTracer.wrapIntervalWorker('dlq-worker', async () => {
    await dlqService.processQueue(processFnMap);
  }, { intervalMs: INTERVAL_MS });

  intervalId = setInterval(async () => {
    try {
      await tracedHandler();
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
