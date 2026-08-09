export class EventPublisher {
  async publish(event) {
    throw new Error('EventPublisher.publish() must be implemented by adapter');
  }

  async publishBatch(events) {
    for (const event of events) {
      await this.publish(event);
    }
  }

  async connect() {}
  async disconnect() {}
  get isConnected() { return false; }
}
