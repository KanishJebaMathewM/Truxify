import logger from '../api/src/middleware/logger.js';

export class ConsulService {
  constructor() {
    this._healthInterval = null;
  }

  startHealthChecks() {
    if (this._healthInterval) {
      return;
    }

    this._healthInterval = setInterval(async () => {
      try {
        await this.checkAllServices();
      } catch (err) {
        logger.error({ err }, 'Failed to execute periodic Consul health checks');
      }
    }, 30000);

    // Fix: Unref the interval so it doesn't keep the Node.js event loop alive unnecessarily
    if (this._healthInterval && typeof this._healthInterval.unref === 'function') {
      this._healthInterval.unref();
    }
  }

  stopHealthChecks() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  async checkAllServices() {
    // Existing check logic...
  }
}

export default ConsulService;
