/**
 * In-memory telemetry buffer service for batching and queueing telemetry metrics.
 */
export class TelemetryBuffer {
  constructor({ maxSize = 1000 } = {}) {
    this.maxSize = maxSize;
    this.items = [];
  }

  /**
   * Current number of buffered items.
   * @returns {number}
   */
  size() {
    return this.items.length;
  }

  /**
   * Adds an item to the buffer. Drops the oldest item if maxSize is reached.
   * @param {Object} item
   */
  add(item) {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
    }
    this.items.push(item);
  }

  /**
   * Flushes and returns all buffered items, clearing the internal buffer.
   * @returns {Array<Object>}
   */
  flush() {
    const flushed = this.items;
    this.items = [];
    return flushed;
  }
}

export default TelemetryBuffer;
