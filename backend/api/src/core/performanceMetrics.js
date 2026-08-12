import logger from '../middleware/logger.js';

const SLOW_THRESHOLD_MS = parseInt(process.env.SLOW_OPERATION_THRESHOLD_MS || '100', 10);

export function measureExecution(name, asyncFn) {
  const start = Date.now();
  return asyncFn().then(result => {
    const durationMs = Date.now() - start;
    if (durationMs > SLOW_THRESHOLD_MS) {
      logger.warn({ durationMs, operation: name, threshold: SLOW_THRESHOLD_MS }, `Slow operation detected`);
    }
    return result;
  }).catch(err => {
    const durationMs = Date.now() - start;
    if (durationMs > SLOW_THRESHOLD_MS) {
      logger.warn({ durationMs, operation: name, threshold: SLOW_THRESHOLD_MS, error: true }, `Slow operation detected (failed)`);
    }
    throw err;
  });
}
