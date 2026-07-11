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

  clear() {
    this._cache.clear();
  }

  get size() {
    return this._cache.size;
  }
}
