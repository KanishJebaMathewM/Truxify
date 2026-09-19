/**
 * CacheMetrics: Telemetry & Observability for Multi-Tier Caching
 * 
 * Tracks L1/L2 hits, misses, XFetch early recomputation triggers,
 * stampede lock contentions, and computation latencies.
 */
export class CacheMetrics {
  constructor() {
    this.reset();
  }

  /**
   * Resets all metric counters.
   */
  reset() {
    this.counters = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      xfetchPrewarms: 0,
      stampedeLocksAcquired: 0,
      stampedeLocksContended: 0,
      l2Fallbacks: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };

    this.latencies = {
      totalComputeMs: 0,
      computeCount: 0,
      maxComputeMs: 0,
    };
  }

  recordL1Hit() {
    this.counters.l1Hits++;
  }

  recordL1Miss() {
    this.counters.l1Misses++;
  }

  recordL2Hit() {
    this.counters.l2Hits++;
  }

  recordL2Miss() {
    this.counters.l2Misses++;
  }

  recordXFetchPrewarm() {
    this.counters.xfetchPrewarms++;
  }

  recordStampedeLockAcquired() {
    this.counters.stampedeLocksAcquired++;
  }

  recordStampedeLockContended() {
    this.counters.stampedeLocksContended++;
  }

  recordL2Fallback() {
    this.counters.l2Fallbacks++;
  }

  recordSet() {
    this.counters.sets++;
  }

  recordDelete() {
    this.counters.deletes++;
  }

  recordError() {
    this.counters.errors++;
  }

  recordComputeDuration(durationMs) {
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.latencies.totalComputeMs += durationMs;
      this.latencies.computeCount++;
      if (durationMs > this.latencies.maxComputeMs) {
        this.latencies.maxComputeMs = durationMs;
      }
    }
  }

  /**
   * Exports snapshot of metrics including calculated hit rates and latency averages.
   * 
   * @returns {object} Formatted metrics payload
   */
  getSnapshot() {
    const totalRequests = this.counters.l1Hits + this.counters.l1Misses;
    const l1HitRate = totalRequests > 0 ? (this.counters.l1Hits / totalRequests) * 100 : 0;
    
    const l2Total = this.counters.l2Hits + this.counters.l2Misses;
    const l2HitRate = l2Total > 0 ? (this.counters.l2Hits / l2Total) * 100 : 0;

    const overallHits = this.counters.l1Hits + this.counters.l2Hits;
    const overallHitRate = totalRequests > 0 ? (overallHits / totalRequests) * 100 : 0;

    const avgComputeMs = this.latencies.computeCount > 0
      ? (this.latencies.totalComputeMs / this.latencies.computeCount).toFixed(2)
      : 0;

    return {
      counters: { ...this.counters },
      performance: {
        avgComputeMs: Number(avgComputeMs),
        maxComputeMs: this.latencies.maxComputeMs,
        computeCount: this.latencies.computeCount,
      },
      rates: {
        l1HitRate: `${l1HitRate.toFixed(1)}%`,
        l2HitRate: `${l2HitRate.toFixed(1)}%`,
        overallHitRate: `${overallHitRate.toFixed(1)}%`,
      },
    };
  }
}

export default CacheMetrics;
