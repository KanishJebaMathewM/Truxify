import logger from '../middleware/logger.js';

export function startTimer(label) {
  const id = `${label}_${Date.now()}`;
  return id;
}

export function endTimer(id) {
  // Timer end logged via withTiming wrapper
}

export function withTiming(label, fn) {
  const start = Date.now();
  try {
    return fn();
  } finally {
    const durationMs = Date.now() - start;
    logger.info({ durationMs, label }, 'route timing');
  }
}
