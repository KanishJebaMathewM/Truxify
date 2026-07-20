import EventEmitter from 'events';
import logger from '../middleware/logger.js';

class EventBus extends EventEmitter {
  constructor() {
    super();
    // Increase limit if we have many subscribers to prevent memory leak warnings
    this.setMaxListeners(20);
  }

  /**
   * Safely emit an event, allowing subscribers to handle failures internally
   * @param {string} event 
   * @param  {...any} args 
   */
  emitSafe(event, ...args) {
    const listeners = this.rawListeners(event);
    for (const listener of listeners) {
      try {
        const result = listener.apply(this, args);
        if (result && typeof result.catch === 'function') {
          result.catch(err =>
            logger.error(`[EventBus] Unhandled async listener error for "${event}":`, err)
          );
        }
      } catch (err) {
        logger.error(`[EventBus] Sync listener error for "${event}":`, err);
      }
    }
    return listeners.length > 0;
  }
}

export const eventBus = new EventBus();
