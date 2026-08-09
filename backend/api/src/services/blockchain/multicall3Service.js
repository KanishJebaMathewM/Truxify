import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { measureExecution } from '../../core/performanceMetrics.js';

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (uint256 blockNumber, tuple(bool success, bytes returnData)[] returnData)',
  'function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns (uint256 blockNumber, tuple(bool success, bytes returnData)[] returnData)',
];

const MAX_CALLS_PER_BATCH = 100;
const CALL_TIMEOUT_MS = 30000;

class Multicall3Service {
  constructor(deps = {}) {
    this.provider = deps.provider;
    this.multicallContract = null;
    this.callCache = new Map();
    this.cacheTimeout = parseInt(process.env.MULTICALL_CACHE_TIMEOUT_MS || '5000', 10);
    this.initializeMulticall();
  }

  initializeMulticall() {
    if (!this.provider) {
      logger.warn('[Multicall3Service] Provider not initialized');
      return;
    }

    try {
      this.multicallContract = new ethers.Contract(
        MULTICALL3_ADDRESS,
        MULTICALL3_ABI,
        this.provider
      );
      logger.info('[Multicall3Service] Multicall3 initialized at', MULTICALL3_ADDRESS);
    } catch (err) {
      logger.error('[Multicall3Service] Initialization failed:', err.message);
      Sentry.captureException(err);
    }
  }

  async batchCalls(calls) {
    return measureExecution('Multicall3Service.batchCalls', async () => {
      if (!this.multicallContract) {
        logger.error('[Multicall3Service] Multicall3 not initialized');
        throw new Error('Multicall3 service not initialized');
      }

      if (calls.length === 0) {
        return [];
      }

      const chunkSize = MAX_CALLS_PER_BATCH;
      const results = [];

      for (let i = 0; i < calls.length; i += chunkSize) {
        const chunk = calls.slice(i, i + chunkSize);
        const chunkResults = await this.executeBatch(chunk);
        results.push(...chunkResults);
      }

      return results;
    });
  }

  async executeBatch(calls) {
    return measureExecution('Multicall3Service.executeBatch', async () => {
      const callsData = calls.map(call => ({
        target: call.target,
        allowFailure: call.allowFailure !== false,
        callData: call.callData,
      }));

      try {
        const result = await Promise.race([
          this.multicallContract.aggregate3(callsData),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Multicall timeout')), CALL_TIMEOUT_MS)
          ),
        ]);

        const { blockNumber, returnData } = result;

        return returnData.map((res, idx) => ({
          success: res.success,
          returnData: res.returnData,
          decoded: this.tryDecodeResult(calls[idx], res.returnData),
          callIndex: idx,
          blockNumber,
        }));
      } catch (err) {
        logger.error('[Multicall3Service] Batch execution failed:', err.message);
        Sentry.captureException(err);

        return calls.map((call, idx) => ({
          success: false,
          error: err.message,
          callIndex: idx,
        }));
      }
    });
  }

  async batchCallsWithCache(calls) {
    const uncachedCalls = [];
    const cachedResults = [];
    const callIndexMap = {};

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const cacheKey = this.generateCacheKey(call);

      if (this.isInCache(cacheKey)) {
        const entry = this.callCache.get(cacheKey);
        cachedResults.push({
          index: i,
          result: entry.value,
          cachedAt: entry.timestamp,
        });
      } else {
        callIndexMap[uncachedCalls.length] = i;
        uncachedCalls.push(call);
      }
    }

    const results = new Array(calls.length);

    if (uncachedCalls.length > 0) {
      const freshResults = await this.batchCalls(uncachedCalls);

      freshResults.forEach((res, idx) => {
        const originalIdx = callIndexMap[idx];
        const call = uncachedCalls[idx];

        if (res.success && !res.error) {
          this.setInCache(this.generateCacheKey(call), res);
        }

        results[originalIdx] = { ...res, cached: false };
      });
    }

    cachedResults.forEach(({ index, result, cachedAt }) => {
      results[index] = { ...result, cached: true, cachedAt };
    });

    return results;
  }

  generateCacheKey(call) {
    const key = `${call.target}:${call.callData}`;
    return Buffer.from(key).toString('hex');
  }

  isInCache(cacheKey) {
    const entry = this.callCache.get(cacheKey);
    if (!entry) return false;

    const isExpired = Date.now() - entry.timestamp > this.cacheTimeout;
    if (isExpired) {
      this.callCache.delete(cacheKey);
      return false;
    }

    return true;
  }

  getFromCache(cacheKey) {
    return this.callCache.get(cacheKey)?.value;
  }

  setInCache(cacheKey, value) {
    this.callCache.set(cacheKey, {
      value,
      timestamp: Date.now(),
    });

    if (this.callCache.size > 1000) {
      const oldestKey = this.callCache.keys().next().value;
      this.callCache.delete(oldestKey);
    }
  }

  clearCache() {
    this.callCache.clear();
    logger.info('[Multicall3Service] Cache cleared');
  }

  tryDecodeResult(call, resultData) {
    try {
      if (call.decodeFn) {
        return call.decodeFn(resultData);
      }
      return resultData;
    } catch (err) {
      logger.warn('[Multicall3Service] Failed to decode result:', err.message);
      return resultData;
    }
  }

  getCacheStats() {
    return {
      size: this.callCache.size,
      maxSize: 1000,
      utilization: ((this.callCache.size / 1000) * 100).toFixed(2) + '%',
    };
  }
}

export default Multicall3Service;
export { MAX_CALLS_PER_BATCH };
