
import crypto from 'crypto';

/**
 * Count-Min Sketch Probabilistic Frequency Estimator
 * with bounded Space-Saving Heavy-Hitters Tracking.
 */
export class CountMinSketch {
  constructor(width = 1000, depth = 5, candidateLimit = 1000) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error('Width must be a positive integer');
    }

    if (!Number.isInteger(depth) || depth <= 0) {
      throw new Error('Depth must be a positive integer');
    }

    if (!Number.isInteger(candidateLimit) || candidateLimit <= 0) {
      throw new Error('Candidate limit must be a positive integer');
    }

    this.width = width;
    this.depth = depth;
    this.candidateLimit = candidateLimit;

    this.table = Array.from(
      { length: depth },
      () => new Float64Array(width)
    );

    this.totalCount = 0;

    // Bounded candidate storage.
    // Each entry contains { item, count, error }.
    this.candidates = new Map();
  }

  /**
   * Normalize supported values to avoid hash collisions
   * between values with different types.
   */
  _normalizeItem(item) {
    if (typeof item === 'string') {
      return `string:${item}`;
    }

    if (typeof item === 'number' && Number.isFinite(item)) {
      return `number:${Object.is(item, -0) ? '-0' : item}`;
    }

    if (typeof item === 'bigint') {
      return `bigint:${item.toString()}`;
    }

    if (typeof item === 'boolean') {
      return `boolean:${item}`;
    }

    throw new Error(
      'Items must be strings, finite numbers, bigints, or booleans'
    );
  }

  /**
   * Generate a deterministic hash index.
   */
  _hash(key, seed) {
    const hash = crypto
      .createHash('sha256')
      .update(`${seed}:${key}`)
      .digest();

    return hash.readUInt32BE(0) % this.width;
  }

  /**
   * Update the bounded Space-Saving candidate collection.
   */
  _trackCandidate(key, item, count) {
    const existing = this.candidates.get(key);

    if (existing) {
      existing.count += count;
      return;
    }

    // Add a new candidate if capacity is available.
    if (this.candidates.size < this.candidateLimit) {
      this.candidates.set(key, {
        item,
        count,
        error: 0
      });

      return;
    }

    // Find the candidate with the smallest estimated count.
    let minKey = null;
    let minCount = Infinity;

    for (const [candidateKey, candidate] of this.candidates) {
      if (candidate.count < minCount) {
        minCount = candidate.count;
        minKey = candidateKey;
      }
    }

    // Replace the minimum candidate.
    this.candidates.delete(minKey);

    this.candidates.set(key, {
      item,
      count: minCount + count,
      error: minCount
    });
  }

  /**
   * Add an item or increment its frequency.
   */
  add(item, count = 1) {
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error('Count must be a positive finite number');
    }

    if (!Number.isFinite(this.totalCount + count)) {
      throw new Error('Total count exceeds the supported numeric range');
    }

    const key = this._normalizeItem(item);

    // Update all hash rows.
    for (let i = 0; i < this.depth; i++) {
      const index = this._hash(key, i);
      this.table[i][index] += count;
    }

    this.totalCount += count;

    // Maintain bounded heavy-hitter candidates.
    this._trackCandidate(key, item, count);

    return this.estimate(item);
  }

  /**
   * Estimate the frequency of an item.
   * Count-Min Sketch never underestimates the true frequency
   * under normal arithmetic conditions.
   */
  estimate(item) {
    const key = this._normalizeItem(item);
    let minCount = Infinity;

    for (let i = 0; i < this.depth; i++) {
      const index = this._hash(key, i);

      minCount = Math.min(
        minCount,
        this.table[i][index]
      );
    }

    return minCount;
  }

  /**
   * Retrieve approximate heavy hitters.
   *
   * threshold: minimum fraction of total stream count.
   * limit: maximum number of results.
   */
  getHeavyHitters(threshold = 0.01, limit = Infinity) {
    if (
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 1
    ) {
      throw new Error('Threshold must be between 0 and 1');
    }

    if (
      limit !== Infinity &&
      (!Number.isInteger(limit) || limit < 0)
    ) {
      throw new Error('Limit must be a non-negative integer');
    }

    if (limit === 0 || this.totalCount === 0) {
      return [];
    }

    return [...this.candidates.entries()]
      .map(([key, candidate]) => ({
        item: candidate.item,
        count: this.estimate(candidate.item),
        error: candidate.error
      }))
      .filter(
        entry => entry.count >= this.totalCount * threshold
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Return sketch configuration and stream statistics.
   */
  getStats() {
    return {
      width: this.width,
      depth: this.depth,
      totalCount: this.totalCount,
      candidateCount: this.candidates.size,
      candidateLimit: this.candidateLimit,
      estimatedError: Math.E / this.width,
      confidence: 1 - Math.exp(-this.depth)
    };
  }

  /**
   * Reset all counters and candidate data.
   */
  reset() {
    this.table.forEach(row => row.fill(0));

    this.totalCount = 0;
    this.candidates.clear();

    return this;
  }
}

// Default reusable instance.
export const countMinSketch = new CountMinSketch();
