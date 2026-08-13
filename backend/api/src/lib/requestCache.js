export class RequestCache {
  constructor() {
    this._cache = new Map();
  }

  get(key) {
    return this._cache.get(key);
  }

  set(key, value) {
    this._cache.set(key, value);
    return this;
  }

  has(key) {
    return this._cache.has(key);
  }

  delete(key) {
    return this._cache.delete(key);
  }

  clear() {
    this._cache.clear();
  }

  get size() {
    return this._cache.size;
  }
}


// === Spec 25: ===
// === Spec 25: event listener leak guard ===
import { EventEmitter } from 'node:events';
export function attachResponseCleanup(emitter, res, eventName = 'data') {
  const onData = () => {};
  emitter.on(eventName, onData);
  const cleanup = () => {
    emitter.removeListener(eventName, onData);
    res.removeListener('finish', cleanup);
    res.removeListener('close', cleanup);
  };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  return cleanup;
}

