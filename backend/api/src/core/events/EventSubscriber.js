export class EventSubscriber {
  async subscribe(eventType, handler) {
    throw new Error('EventSubscriber.subscribe() must be implemented by adapter');
  }

  async unsubscribe(eventType, handler) {
    throw new Error('EventSubscriber.unsubscribe() must be implemented by adapter');
  }

  async subscribeAll(handlers) {
    const results = [];
    for (const [eventType, handler] of Object.entries(handlers)) {
      results.push(await this.subscribe(eventType, handler));
    }
    return results;
  }

  async connect() {}
  async disconnect() {}
  get isConnected() { return false; }
}
