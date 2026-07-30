import { EventPublisher } from '../EventPublisher.js';
import logger from '../../../middleware/logger.js';

export class LocalEventEmitterAdapter extends EventPublisher {
  constructor(eventBus) {
    super();
    this._eventBus = eventBus;
  }

  async publish(event) {
    try {
      this._eventBus.emitSafe(event.eventType, event);
      logger.debug(`[LocalEventEmitterAdapter] Published "${event.eventType}"`);
    } catch (err) {
      logger.error(`[LocalEventEmitterAdapter] Failed to publish "${event.eventType}":`, err.message);
      throw err;
    }
  }
}
