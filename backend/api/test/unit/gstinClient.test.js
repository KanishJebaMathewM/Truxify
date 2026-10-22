import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/circuitBreaker.js', () => ({
  CircuitBreaker: class {
    async execute(operation) {
      return operation();
    }
  },
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from 'axios';
import { GstinClient } from '../../src/services/verification/gstinClient.js';

const GSTIN_A = '27AAPFU0939F1ZV';
const GSTIN_B = '29AABCU9603R1ZM';

const client = (overrides = {}) => new GstinClient({
  baseUrl: 'https://gst.example.test',
  apiKey: 'test-key',
  ...overrides,
});

describe('GstinClient provider failure handling', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed and does not cache a transient provider failure', async () => {
    axios.get.mockRejectedValue(new Error('upstream timeout'));
    const gstinClient = client();

    const first = await gstinClient.verifyTaxpayerStatus(GSTIN_A);
    const second = await gstinClient.verifyTaxpayerStatus(GSTIN_A);

    expect(first).toMatchObject({
      isValid: false,
      status: 'VERIFICATION_UNAVAILABLE',
      isBlocked: true,
      retryable: true,
    });
    expect(second.status).toBe('VERIFICATION_UNAVAILABLE');
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(gstinClient.cache.size).toBe(0);
  });

  it('fails closed when the provider returns a successful response with no status', async () => {
    axios.get.mockResolvedValue({ data: {} });
    const result = await client().verifyTaxpayerStatus(GSTIN_A);

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('VERIFICATION_UNAVAILABLE');
  });

  it('returns and caches a live active result', async () => {
    axios.get.mockResolvedValue({
      data: { status: 'Active', legalName: 'Acme Logistics Pvt Ltd' },
    });
    const gstinClient = client();

    const first = await gstinClient.verifyTaxpayerStatus(GSTIN_A);
    const second = await gstinClient.verifyTaxpayerStatus(GSTIN_A);

    expect(first).toMatchObject({
      isValid: true,
      status: 'ACTIVE',
      legalName: 'Acme Logistics Pvt Ltd',
      source: 'LIVE_GST_PORTAL',
    });
    expect(second).toEqual(first);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('expires cached results after the configured TTL', async () => {
    axios.get.mockResolvedValue({ data: { status: 'Active' } });
    const gstinClient = client({ cacheTtlMs: 5 });

    await gstinClient.verifyTaxpayerStatus(GSTIN_A);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await gstinClient.verifyTaxpayerStatus(GSTIN_A);

    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest cache entry when the bound is reached', async () => {
    axios.get.mockResolvedValue({ data: { status: 'Active' } });
    const gstinClient = client({ maxCacheEntries: 1 });

    await gstinClient.verifyTaxpayerStatus(GSTIN_A);
    await gstinClient.verifyTaxpayerStatus(GSTIN_B);
    await gstinClient.verifyTaxpayerStatus(GSTIN_A);

    expect(gstinClient.cache.size).toBe(1);
    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed GSTINs without calling the provider', async () => {
    const result = await client().verifyTaxpayerStatus('not-a-gstin');

    expect(result).toMatchObject({
      isValid: false,
      status: 'INVALID_FORMAT',
      isBlocked: true,
    });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
