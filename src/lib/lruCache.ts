export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, { value: V; timestamp: number }>;
  constructor(capacity: number) { this.capacity = capacity; this.cache = new Map(); }
  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const item = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }
  set(key: K, value: V) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.capacity) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { value, timestamp: Date.now() });
  }
}