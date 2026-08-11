import crypto from 'crypto';

/**
 * Count-Min Sketch Probabilistic Frequency Estimator & Heavy-Hitters Engine
 */
export class CountMinSketch {
  constructor(width = 1000, depth = 5) {
    this.width = width;
    this.depth = depth;
    this.table = Array.from({ length: depth }, () => new Uint32Array(width));
  }

  _hash(item, seed) {
    const hash = crypto.createHash('md5').update(`${seed}:${item}`).digest();
    return hash.readUInt32BE(0) % this.width;
  }

  add(item, count = 1) {
    for (let i = 0; i < this.depth; i++) {
      const idx = this._hash(item, i);
      this.table[i][idx] += count;
    }
  }

  estimate(item) {
    let minCount = Infinity;
    for (let i = 0; i < this.depth; i++) {
      const idx = this._hash(item, i);
      minCount = Math.min(minCount, this.table[i][idx]);
    }
    return minCount === Infinity ? 0 : minCount;
  }
}

export const countMinSketch = new CountMinSketch();
