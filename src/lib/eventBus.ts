type Listener<T = any> = (data: T) => void;
export class EventBus<T = any> {
  private listeners: Map<string, Listener<T>[]> = new Map();
  subscribe(event: string, callback: Listener<T>) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(callback);
    return () => this.unsubscribe(event, callback);
  }
  unsubscribe(event: string, callback: Listener<T>) {
    if (!this.listeners.has(event)) return;
    const filtered = this.listeners.get(event)!.filter(cb => cb !== callback);
    if (filtered.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, filtered);
    }
  }
  publish(event: string, data: T) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(cb => {
        try {
          cb(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }
}