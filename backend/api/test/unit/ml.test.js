/**
 * Unit tests for backend/api/src/services/ml.js
 *
 * Coverage:
 *   - predictDemand constructs correct URL from ML_ENGINE_URL or default
 *   - predictDemand sends correct JSON body
 *   - predictDemand throws on non-ok response
 *   - predictDemand returns parsed JSON on success
 *   - predictPrice constructs correct URL from ML_SERVICE_URL / ML_ENGINE_URL
 *   - predictPrice sends correct JSON body
 *   - predictPrice throws on non-ok response
 *   - predictPrice returns { estimated_price, currency } on success
 *   - Both use 5000ms AbortSignal.timeout
 *
 * Run with:  npm run test:unit -- test/unit/ml.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { predictDemand, predictPrice } from '../../src/services/ml.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const DEFAULT_URL = 'http://localhost:8001';

function mockFetch(response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

describe('predictDemand', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('calls the ML engine at /predict/demand with correct body', async () => {
    const features = { hour: 9, day_of_week: 2, temperature: 22, precipitation: 0, historical_volume: 50, nearby_drivers: 10 };
    const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ demand: 0.85 }) };
    mockFetch(mockResponse);
    await predictDemand(features);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_URL}/predict/demand`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toMatchObject(features);
  });

  it('uses ML_ENGINE_URL env var when set', async () => {
    vi.stubEnv('ML_ENGINE_URL', 'http://ml-engine:9000');
    const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ demand: 0.5 }) };
    mockFetch(mockResponse);
    await predictDemand({ hour: 12 });
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('http://ml-engine:9000/predict/demand');
  });

  it('throws an error when ML engine returns non-ok status', async () => {
    const mockResponse = { ok: false, statusText: 'Service Unavailable', text: vi.fn().mockResolvedValue('server error') };
    mockFetch(mockResponse);
    await expect(predictDemand({ hour: 9 })).rejects.toThrow('Service Unavailable');
  });

  it('returns parsed JSON on successful response', async () => {
    const mockData = { demand: 0.75, confidence: 0.92 };
    mockFetch({ ok: true, json: vi.fn().mockResolvedValue(mockData) });
    const result = await predictDemand({ hour: 9 });
    expect(result).toEqual(mockData);
  });

  it('uses a 5000ms timeout on the fetch signal', async () => {
    mockFetch({ ok: true, json: vi.fn().mockResolvedValue({}) });
    await predictDemand({ hour: 9 });
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('predictPrice', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('calls the ML service at /predict with correct body', async () => {
    const params = { distanceKm: 150, cargoWeightKg: 2000, truckType: 'flatbed', routeOrigin: 'Mumbai', routeDestination: 'Pune' };
    mockFetch({ ok: true, json: vi.fn().mockResolvedValue({ estimated_price: 4500, currency: 'INR' }) });
    await predictPrice(params);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_URL}/predict`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(options.body);
    expect(parsed.distance_km).toBe(150);
    expect(parsed.cargo_weight_kg).toBe(2000);
    expect(parsed.truck_type).toBe('flatbed');
  });

  it('uses ML_SERVICE_URL env var when set', async () => {
    vi.stubEnv('ML_SERVICE_URL', 'http://ml-price:8001');
    mockFetch({ ok: true, json: vi.fn().mockResolvedValue({}) });
    await predictPrice({ distanceKm: 100 });
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('http://ml-price:8001/predict');
  });

  it('falls back to ML_ENGINE_URL when ML_SERVICE_URL is not set', async () => {
    vi.stubEnv('ML_ENGINE_URL', 'http://ml-engine:9000');
    mockFetch({ ok: true, json: vi.fn().mockResolvedValue({}) });
    await predictPrice({ distanceKm: 50 });
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('http://ml-engine:9000/predict');
  });

  it('throws an error when ML service returns non-ok status', async () => {
    mockFetch({ ok: false, statusText: 'Internal Server Error', text: vi.fn().mockResolvedValue('ml crash') });
    await expect(predictPrice({ distanceKm: 100 })).rejects.toThrow('Internal Server Error');
  });

  it('returns { estimated_price, currency } on success', async () => {
    mockFetch({ ok: true, json: vi.fn().mockResolvedValue({ estimated_price: 3200, currency: 'INR' }) });
    const result = await predictPrice({ distanceKm: 80 });
    expect(result).toEqual({ estimated_price: 3200, currency: 'INR' });
  });
});
