type Listener<T = any> = (data: T) => void;

export class EventBus<T = any> {
  private listeners: Map<string, Listener<T>[]> = new Map();

  subscribe(event: string, callback: Listener<T>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const listeners = this.listeners.get(event)!;

    // Prevent duplicate listener registration
    if (!listeners.includes(callback)) {
      listeners.push(callback);
    }

    return () => this.unsubscribe(event, callback);
  }

  unsubscribe(event: string, callback: Listener<T>) {
    const listeners = this.listeners.get(event);

    if (!listeners) {
      return;
    }

    const filtered = listeners.filter((cb) => cb !== callback);

    if (filtered.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, filtered);
    }
  }

  publish(event: string, data: T) {
    const listeners = this.listeners.get(event);

    if (!listeners) {
      return;
    }

    // Copy the array so listeners can safely subscribe/unsubscribe
    // while the event is being published.
    [...listeners].forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(
          `Error in event listener for ${event}:`,
          error
        );
      }
    });
  }
}
