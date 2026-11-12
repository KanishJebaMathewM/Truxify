
import crypto from 'crypto';

/**
 * Count-Min Sketch Probabilistic Frequency Estimator
 * with Heavy-Hitters Tracking
 */
export class CountMinSketch {
  constructor(width = 1000, depth = 5) {
    if (width <= 0 || depth <= 0) {
      throw new Error('Width and depth must be positive');
    }

    this.width = width;
    this.depth = depth;
    this.table = Array.from(
      { length: depth },
      () => new Float64Array(width)
    );
    this.totalCount = 0;
    this.candidates = new Map();
  }

  _hash(item, seed) {
    const hash = crypto
      .createHash('md5')
      .update(`${seed}:${String(item)}`)
      .digest();

    return hash.readUInt32BE(0) % this.width;
  }

  add(item, count = 1) {
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error('Count must be a positive number');
    }

    for (let i = 0; i < this.depth; i++) {
      const index = this._hash(item, i);
      this.table[i][index] += count;
    }

    this.totalCount += count;
    this.candidates.set(item, this.estimate(item));
  }

  estimate(item) {
    let minCount = Infinity;

    for (let i = 0; i < this.depth; i++) {
      const index = this._hash(item, i);
      minCount = Math.min(minCount, this.table[i][index]);
    }

    return minCount;
  }

  getHeavyHitters(threshold = 0.01) {
    return [...this.candidates.entries()]
      .map(([item]) => ({
        item,
        count: this.estimate(item)
      }))
      .filter(entry => entry.count >= this.totalCount * threshold)
      .sort((a, b) => b.count - a.count);
  }

  reset() {
    this.table.forEach(row => row.fill(0));
    this.totalCount = 0;
    this.candidates.clear();
  }
}

export const countMinSketch = new CountMinSketch();

