/**
 * Unit tests for backend/api/src/services/ml.js
 *
 * Coverage:
 *   - predictDemand: successful response, auth failure, non-ok response, network error
 *   - predictPrice: successful response, auth failure, non-ok response, network error,
 *                   default truckType when not provided
 *
 * Run with:  npm run test:unit -- test/unit/ml.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { predictDemand, predictPrice } from '../../src/services/ml.js';

describe('ml service — predictDemand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    delete process.env.ML_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the ML engine /predict/demand endpoint with correct body', async () => {
    const features = {
      hour: 10,
      day_of_week: 3,
      temperature: 28,
      precipitation: 0,
      historical_volume: 120,
      nearby_drivers: 15,
    };
    const mockResponse = { predicted_demand: 0.82, demand_level: 'high' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await predictDemand(features);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/predict/demand');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject(features);
    expect(result).toEqual(mockResponse);
  });

  it('uses ML_ENGINE_URL env var when set', async () => {
    process.env.ML_ENGINE_URL = 'http://ml-service:9000';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ predicted_demand: 0.5 }),
    });

    await predictDemand({ hour: 12, day_of_week: 1, temperature: 25, precipitation: 0, historical_volume: 100, nearby_drivers: 10 });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('http://ml-service:9000');
    delete process.env.ML_ENGINE_URL;
  });

  it('throws with descriptive message on 401/403 auth failure', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 401,
      ok: false,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Invalid API key'),
    });

    await expect(predictDemand({ hour: 12, day_of_week: 1, temperature: 25, precipitation: 0, historical_volume: 100, nearby_drivers: 10 }))
      .rejects
      .toThrow('ML Engine authentication failed: 401');
  });

  it('throws with descriptive message on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 500,
      ok: false,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Model not loaded'),
    });

    await expect(predictDemand({ hour: 12, day_of_week: 1, temperature: 25, precipitation: 0, historical_volume: 100, nearby_drivers: 10 }))
      .rejects
      .toThrow('ML Engine request failed: Internal Server Error');
  });

  it('adds X-API-Key header when ML_API_KEY env var is set', async () => {
    process.env.ML_API_KEY = 'secret-key-123';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ predicted_demand: 0.5 }),
    });

    await predictDemand({ hour: 12, day_of_week: 1, temperature: 25, precipitation: 0, historical_volume: 100, nearby_drivers: 10 });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-API-Key']).toBe('secret-key-123');
    expect(opts.headers['Content-Type']).toBe('application/json');
    delete process.env.ML_API_KEY;
  });

  it('rejects when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

    await expect(predictDemand({ hour: 12, day_of_week: 1, temperature: 25, precipitation: 0, historical_volume: 100, nearby_drivers: 10 }))
      .rejects
      .toThrow('Network unreachable');
  });
});

describe('ml service — predictPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_SERVICE_URL;
    delete process.env.ML_ENGINE_URL;
    delete process.env.ML_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the ML engine /predict endpoint with correct body', async () => {
    const mockResponse = { estimated_price: 4500, currency: 'INR' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await predictPrice({
      distanceKm: 250,
      cargoWeightKg: 1000,
      truckType: 'heavy_truck',
      routeOrigin: 'Mumbai',
      routeDestination: 'Pune',
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/predict');
    const body = JSON.parse(opts.body);
    expect(body.distance_km).toBe(250);
    expect(body.cargo_weight_kg).toBe(1000);
    expect(body.truck_type).toBe('heavy_truck');
    expect(body.route_origin).toBe('Mumbai');
    expect(body.route_destination).toBe('Pune');
    expect(result).toEqual(mockResponse);
  });

  it('defaults truckType to medium_truck when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ estimated_price: 3000, currency: 'INR' }),
    });

    await predictPrice({ distanceKm: 100, cargoWeightKg: 500 });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.truck_type).toBe('medium_truck');
  });

  it('prefers ML_SERVICE_URL over ML_ENGINE_URL for price prediction', async () => {
    process.env.ML_SERVICE_URL = 'http://price-service:8002';
    process.env.ML_ENGINE_URL = 'http://demand-service:8001';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ estimated_price: 2000, currency: 'INR' }),
    });

    await predictPrice({ distanceKm: 50, cargoWeightKg: 200 });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('price-service:8002');
    delete process.env.ML_SERVICE_URL;
    delete process.env.ML_ENGINE_URL;
  });

  it('throws with descriptive message on 401/403 auth failure', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 403,
      ok: false,
      statusText: 'Forbidden',
      text: () => Promise.resolve('Forbidden'),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('ML Engine authentication failed: 403');
  });

  it('throws with descriptive message on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 502,
      ok: false,
      statusText: 'Bad Gateway',
      text: () => Promise.resolve('Upstream error'),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('ML Engine request failed: Bad Gateway');
  });

  it('rejects when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('Connection refused');
  });
});
