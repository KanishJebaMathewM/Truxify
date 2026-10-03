/**
 * Adaptive Polling Module for Telemetry Buffer
 * Resolves Issue #6691: MongoDB telemetry poll creates busy-wait under high load
 * 
 * Instead of a fixed setTimeout interval, this module calculates the next
 * polling delay based on the current queue depth. Under high load, the interval
 * shrinks to clear backlogs faster; under low load, it expands to save CPU/DB resources.
 */

const DEFAULT_QUEUE_THRESHOLD = 100;
const MAX_BACKOFF_MULTIPLIER = 2;
const MIN_BACKOFF_DIVISOR = 2;
const MIN_INTERVAL_MS = 10;

/**
 * Calculates the next polling interval based on queue depth.
 * 
 * @param {number} queueDepth - Current number of pending telemetry records.
 * @param {number} baseIntervalMs - The configured default polling interval.
 * @param {number} threshold - The queue depth threshold to trigger aggressive polling.
 * @returns {number} The calculated delay in milliseconds.
 */
export function calculateAdaptiveInterval(
  queueDepth,
  baseIntervalMs,
  threshold = DEFAULT_QUEUE_THRESHOLD
) {
  if (queueDepth > threshold) {
    // High load: Poll faster (halve the interval) to prevent backlog.
    // Bound by MIN_INTERVAL_MS to prevent CPU spinning.
    return Math.max(baseIntervalMs / MIN_BACKOFF_DIVISOR, MIN_INTERVAL_MS);
  }
  
  // Low/Normal load: Back off to reduce DB pressure.
  return Math.min(baseIntervalMs * MAX_BACKOFF_MULTIPLIER, baseIntervalMs * 2);
}

/**
 * Safely extracts the current queue depth from the telemetry buffer.
 * 
 * @param {object} telemetryBuffer - The shared telemetry buffer instance.
 * @returns {number} The number of pending writes.
 */
export function getQueueDepth(telemetryBuffer) {
  if (!telemetryBuffer || typeof telemetryBuffer.getMetrics !== 'function') {
    return 0;
  }
  
  try {
    const metrics = telemetryBuffer.getMetrics();
    // Fallback chain depending on how the buffer exposes its state
    return metrics.pendingWrites || metrics.bufferSize || metrics.retryQueueSize || 0;
  } catch (err) {
    return 0;
  }
}
