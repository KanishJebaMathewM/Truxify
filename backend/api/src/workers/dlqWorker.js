import { dlqService } from '../services/webhook/dlqService.js';
import logger from '../middleware/logger.js';
import { processEscrowWebhookEvent } from '../services/webhook/escrowWebhookProcessor.js';
import { WorkerTracer } from '../core/telemetry/WorkerTracer.js';

const processFnMap = {
  escrow: processEscrowWebhookEvent,
};

const DEFAULT_INTERVAL_MS = 60 * 1000; // Poll every 1 minute

let intervalId = null;
// In-process guard preventing overlapping cycles within THIS process. It is NOT
// the distributed coordination mechanism — cross-replica exclusivity is
// provided by the database-level lease claim (claim_webhook_failure_batch).
let cycleRunning = false;

export const startDlqWorker = () => {
  if (intervalId) return;

  const configuredInterval = Number(process.env.DLQ_WORKER_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  const tracedHandler = WorkerTracer.wrapIntervalWorker('dlq-worker', async () => {
    if (cycleRunning) {
      logger.warn('[DLQ Worker] Previous cycle still running — skipping overlapping interval.');
      return;
    }
    cycleRunning = true;
    try {
      await dlqService.processQueue(processFnMap);
    } finally {
      cycleRunning = false;
    }
  }, { intervalMs });

  intervalId = setInterval(async () => {
    try {
      await tracedHandler();
    } catch (err) {
      // A failing cycle must never crash the API process; the next interval
      // will retry. The claim is idempotent across workers, so events are
      // never lost.
      logger.error(`[DLQ Worker] Error in polling loop: ${err.message}`);
    }
  }, intervalMs);

  logger.info(`[DLQ Worker] Started Dead Letter Queue polling worker (every ${intervalMs}ms).`);
};

export const stopDlqWorker = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    cycleRunning = false;
    logger.info('[DLQ Worker] Stopped Dead Letter Queue polling worker.');
  }
};
