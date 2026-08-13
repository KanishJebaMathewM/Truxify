import { EventPublisher } from '../EventPublisher.js';
import { EventSubscriber as EventSubscriberBase } from '../EventSubscriber.js';
import logger from '../../../middleware/logger.js';
import EventEmitter from 'events';

export class InternalEventAdapter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._connected = true;
  }

  get isConnected() {
    return this._connected;
  }

  async connect() {
    this._connected = true;
  }

  async disconnect() {
    this.removeAllListeners();
    this._connected = false;
  }

  async publish(event) {
    if (!this._connected) {
      throw new Error('[InternalEventAdapter] Not connected');
    }
    this.emit(event.eventType, event);
    logger.debug(`[InternalEventAdapter] Published "${event.eventType}" locally`);
  }

  async subscribe(eventType, handler) {
    if (!this._connected) {
      throw new Error('[InternalEventAdapter] Not connected');
    }
    this.on(eventType, handler);
    logger.debug(`[InternalEventAdapter] Subscribed to "${eventType}"`);
  }

  async unsubscribe(eventType, handler) {
    this.removeListener(eventType, handler);
  }
}
