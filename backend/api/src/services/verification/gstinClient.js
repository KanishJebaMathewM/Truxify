import axios from 'axios';
import logger from '../../middleware/logger.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';
import { GSTIN_REGEX } from './ewayBillParser.js';

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 5000;

export class GstinClient {
  /**
   * @param {object} [options={}]
   * @param {string} [options.baseUrl] - GST API gateway URL
   * @param {string} [options.apiKey] - API authentication key
   * @param {number} [options.timeoutMs=5000] - Request timeout
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.GST_API_URL || 'https://api.gst.gov.in/taxpayerapi/v1.0';
    this.apiKey = options.apiKey || process.env.GST_API_KEY || '';
    this.timeoutMs = options.timeoutMs || 5000;
    this.cacheTtlMs = Number.isFinite(options.cacheTtlMs) && options.cacheTtlMs > 0
      ? options.cacheTtlMs
      : DEFAULT_CACHE_TTL_MS;
    this.maxCacheEntries = Number.isInteger(options.maxCacheEntries) && options.maxCacheEntries > 0
      ? options.maxCacheEntries
      : DEFAULT_MAX_CACHE_ENTRIES;

    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      cooldownPeriod: 30000,
    });

    this.cache = new Map(); // Only successful live portal results
  }

  getCached(gstin) {
    const entry = this.cache.get(gstin);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(gstin);
      return null;
    }
    return entry.result;
  }

  setCached(gstin, result) {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(gstin, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Verifies a GSTIN taxpayer registration status against the GST portal.
   * 
   * @param {string} gstin - 15-character GSTIN
   * @returns {Promise<{isValid: boolean, status: string, legalName: string, stateCode: string, isBlocked: boolean}>}
   */
  async verifyTaxpayerStatus(gstin) {
    if (!gstin || typeof gstin !== 'string') {
      return { isValid: false, status: 'INVALID_FORMAT', legalName: '', stateCode: '', isBlocked: true };
    }

    const cleanGstin = gstin.trim().toUpperCase();

    if (!GSTIN_REGEX.test(cleanGstin)) {
      return { isValid: false, status: 'INVALID_FORMAT', legalName: '', stateCode: '', isBlocked: true };
    }

    // 1. Check the bounded, expiring cache of live portal results
    const cached = this.getCached(cleanGstin);
    if (cached) {
      return cached;
    }

    // 2. Fetch from GST Portal API via Circuit Breaker
    try {
      const response = await this.breaker.execute(async () => {
        return axios.get(`${this.baseUrl}/taxpayers/${cleanGstin}`, {
          timeout: this.timeoutMs,
          headers: {
            'X-API-KEY': this.apiKey,
            'Accept': 'application/json',
          },
        });
      });

      const data = response?.data || {};
      const rawStatus = data.status || data.taxpayerStatus;
      if (typeof rawStatus !== 'string' || rawStatus.trim() === '') {
        throw new Error('GST portal response did not include a taxpayer status');
      }
      const status = rawStatus.trim().toUpperCase();
      const legalName = data.legalName || data.tradeName || data.lgnm || 'Verified Taxpayer';
      const stateCode = cleanGstin.slice(0, 2);
      const isBlocked = status !== 'ACTIVE';

      const result = {
        isValid: !isBlocked,
        status,
        legalName,
        stateCode,
        isBlocked,
        source: 'LIVE_GST_PORTAL',
        verifiedAt: new Date().toISOString(),
      };

      this.setCached(cleanGstin, result);
      return result;
    } catch (err) {
      logger.warn(
        { err: err.message, gstin: cleanGstin },
        '[GstinClient] Live GST lookup unavailable; failing closed'
      );

      // A transient provider failure says nothing about the taxpayer. Do not
      // synthesize an active registration and do not cache the failure, so the
      // next request can retry as soon as the provider recovers.
      return {
        isValid: false,
        status: 'VERIFICATION_UNAVAILABLE',
        legalName: '',
        stateCode: cleanGstin.slice(0, 2),
        isBlocked: true,
        source: 'UNAVAILABLE',
        retryable: true,
        verifiedAt: new Date().toISOString(),
      };
    }
  }
}

export default GstinClient;
