import logger from '../../middleware/logger.js';

export class TelemetryBuffer {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 50;
    this.flushIntervalMs = options.flushIntervalMs || 10000;
    this.buffer = [];
    this.flushCallback = options.flushCallback || async (batch) => {
      logger.info({ count: batch.length }, '[TelemetryBuffer] Default flush batch');
    };

    this.timer = null;
    this._startTimer();
  }

  async add(event) {
    if (!event) return;
    this.buffer.push({
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    });

    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush() {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.flushCallback(batch);
    } catch (err) {
      logger.error({ err: err?.message, batchSize: batch.length }, '[TelemetryBuffer] Flush callback failed.');
    }
  }

  _startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error({ err: err?.message }, '[TelemetryBuffer] Interval flush error.');
      });
    }, this.flushIntervalMs);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export default TelemetryBuffer;
