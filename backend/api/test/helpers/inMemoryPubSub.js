/**
 * In-memory Redis Pub/Sub transport for testing the distributed location
 * fan-out without a live Redis server.
 *
 * The API surface mimics the subset of ioredis that `locationEventBus.js`
 * relies on (subscribe/unsubscribe/on/message/status), so a bus created with
 * `subscriberFactory` + `publisher` connected to the same hub behaves exactly
 * like two API replicas sharing one real Redis channel.
 */

export class FakeSubscriber {
  constructor(hub) {
    this.hub = hub;
    this.status = 'ready';
    this.subscribedChannels = new Set();
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return this;
  }

  _emit(event, ...args) {
    const handlers = this._listeners.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      handler(...args);
    }
  }

  subscribe(channel, callback) {
    this.subscribedChannels.add(channel);
    this.status = 'ready';
    if (typeof callback === 'function') callback(null);
    return this;
  }

  unsubscribe(channel) {
    this.subscribedChannels.delete(channel);
    return Promise.resolve(1);
  }

  quit() {
    this.status = 'end';
    return Promise.resolve('OK');
  }

  disconnect() {
    this.status = 'end';
  }

  /** Simulate ioredis delivering a Pub/Sub message to this subscriber. */
  _deliverMessage(channel, message) {
    if (this.status === 'end') return;
    this._emit('message', channel, message);
  }

  /** Simulate a connection drop. */
  _dropConnection() {
    this.status = 'connecting';
    this._emit('close');
  }

  /** Simulate ioredis reconnecting / resubscribing. */
  _reconnect() {
    this.status = 'ready';
    this._emit('reconnecting');
    this._emit('ready');
  }
}

export class InMemoryHub {
  constructor() {
    this.subscribers = new Set();
    this.published = [];
  }

  publish(channel, message) {
    this.published.push({ channel, message });
    let count = 0;
    for (const subscriber of this.subscribers) {
      if (subscriber.subscribedChannels.has(channel)) {
        subscriber._deliverMessage(channel, message);
        count++;
      }
    }
    return count;
  }

  createSubscriber() {
    const subscriber = new FakeSubscriber(this);
    this.subscribers.add(subscriber);
    return subscriber;
  }
}

/** Convenience: a publisher client bound to the hub (mimics ioredis publish). */
export function hubPublisher(hub) {
  return {
    publish(channel, message) {
      return Promise.resolve(hub.publish(channel, message));
    },
  };
}
