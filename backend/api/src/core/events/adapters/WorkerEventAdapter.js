import { EventPublisher } from '../EventPublisher.js';
import { EventSubscriber } from '../EventSubscriber.js';
import logger from '../../../middleware/logger.js';

export class WorkerEventAdapter extends EventPublisher {
  constructor(options = {}) {
    super();
    this._workers = new Map();
    this._messageHandlers = new Map();
    this._connected = true;
    this._workerFactory = options.workerFactory || null;
  }

  get isConnected() {
    return this._connected;
  }

  async connect() {
    this._connected = true;
    logger.info('[WorkerEventAdapter] Connected');
  }

  async disconnect() {
    for (const [name, worker] of this._workers) {
      try {
        if (worker.terminate) {
          await worker.terminate();
        }
      } catch (err) {
        logger.error(`[WorkerEventAdapter] Failed to terminate worker "${name}":`, err.message);
      }
    }
    this._workers.clear();
    this._messageHandlers.clear();
    this._connected = false;
    logger.info('[WorkerEventAdapter] Disconnected');
  }

  registerWorker(name, worker) {
    this._workers.set(name, worker);

    if (worker.on) {
      worker.on('message', (message) => {
        if (message && message.eventType) {
          const event = {
            metadata: {
              eventType: message.eventType,
              source: `worker:${name}`,
              timestamp: new Date().toISOString(),
              ...message.metadata,
            },
            payload: message.payload || message,
          };
          this._emitWorkerEvent(event);
        }
      });
    }

    logger.info(`[WorkerEventAdapter] Worker "${name}" registered`);
    return this;
  }

  removeWorker(name) {
    this._workers.delete(name);
    this._messageHandlers.delete(name);
    return this;
  }

  async publish(event) {
    if (!this._connected) {
      throw new Error('[WorkerEventAdapter] Not connected');
    }

    const message = {
      eventType: event.eventType,
      payload: event.payload,
      metadata: event.metadata?.toJSON ? event.metadata.toJSON() : event.metadata,
    };

    for (const [name, worker] of this._workers) {
      try {
        if (worker.postMessage) {
          worker.postMessage(message);
        } else if (worker.send) {
          worker.send(message);
        }
        logger.debug(`[WorkerEventAdapter] Sent "${event.eventType}" to worker "${name}"`);
      } catch (err) {
        logger.error(`[WorkerEventAdapter] Failed to send to worker "${name}":`, err.message);
      }
    }
  }

  onWorkerMessage(workerName, handler) {
    if (!this._messageHandlers.has(workerName)) {
      this._messageHandlers.set(workerName, []);
    }
    this._messageHandlers.get(workerName).push(handler);
  }

  _emitWorkerEvent(event) {
    for (const [, handlers] of this._messageHandlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result && typeof result.catch === 'function') {
            result.catch(err => logger.error('[WorkerEventAdapter] Handler error:', err.message));
          }
        } catch (err) {
          logger.error('[WorkerEventAdapter] Handler error:', err.message);
        }
      }
    }
  }
}
