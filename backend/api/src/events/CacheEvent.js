import logger from '../middleware/logger.js';

export class CacheEvent {
  static async handleEvent(eventPayload) {
    try {
      // Existing cache event processing logic
      if (!eventPayload || !eventPayload.key) {
        throw new Error('Invalid cache event payload');
      }
      
      // Process event...
      logger.info({ key: eventPayload.key }, 'Cache event processed successfully');
    } catch (e) {
      // Fixed: Properly reference the caught error variable in the logger context
      logger.error({ err: e }, 'Failed to process cache event due to an unexpected error');
      
      // Optional: rethrow or handle gracefully depending on event requirements
      throw e;
    }
  }
}

export default CacheEvent;
