/**
 * Unit tests for backend/api/src/services/ml.js
 *
 * Coverage:
 *   - predictDemand: successful response, auth failure, non-ok response, network error
 *   - predictPrice: successful response, auth failure, non-ok response, network error,
 *                   default truckType when not provided
 *   - predictPrice validation: rejects NaN, Infinity, negative, missing fields,
 *                              above-max, below-min; accepts valid with paisa conversion
 *   - predictEta: correct payload shape, response validation
 *   - matchBilateral: correct payload shape (loads + drivers)
 *   - predictDriverProfit: correct payload shape, response validation
 *   - optimisePacking: correct payload shape (packages + truck + deliveryAddresses)
 *   - recommendLoads: correct payload shape (userId + history)
 *   - recommendTrucks: correct payload shape (userId + history)
 *   - scoreTrust: correct payload shape (behavioral metrics)
 *   - matchDeadhead: correct payload shape (passthrough)
 *
 * Run with:  npm run test:unit -- test/unit/ml.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  predictDemand,
  predictPrice,
  predictEta,
  matchBilateral,
  predictDriverProfit,
  optimisePacking,
  recommendLoads,
  recommendTrucks,
  scoreTrust,
  matchDeadhead,
  __testing,
} from '../../src/services/ml.js';

describe('ml service — predictDemand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
    __testing.demandCache.clear();
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
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
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
      text: () => Promise.resolve(JSON.stringify({ predicted_demand: 0.5 })),
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
      .toThrow('[ML] Authentication failed (401)');
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
      .toThrow('[ML] Request failed (500)');
  });

  it('adds X-API-Key header when ML_API_KEY env var is set', async () => {
    process.env.ML_API_KEY = 'secret-key-123';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ predicted_demand: 0.5 })),
    });

    await predictDemand({ hour: 12, day_of_week: 1, temperature: 25, precipitation: 0, historical_volume: 100, nearby_drivers: 10 });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-API-Key']).toBe('secret-key-123');
    expect(opts.headers['Content-Type']).toBe('application/json');
    process.env.ML_API_KEY = 'test_key';
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
    process.env.ML_API_KEY = 'test_key';
    __testing.priceCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the ML engine /predict endpoint with correct body and returns validated result', async () => {
    const mockResponse = { estimated_price: 4500, currency: 'INR' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await predictPrice({
      distanceKm: 250,
      cargoWeightKg: 1000,
      truckType: 'heavy_truck',
      routeOrigin: 'Mumbai',
      routeDestination: 'Pune',
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/predict/price');
    const body = JSON.parse(opts.body);
    expect(body.distance_km).toBe(250);
    expect(body.cargo_weight_kg).toBe(1000);
    expect(body.truck_type).toBe('heavy_truck');
    expect(body.route_origin).toBe('Mumbai');
    expect(body.route_destination).toBe('Pune');
    expect(result.estimated_price).toBe(4500);
    expect(result.estimatedPricePaisa).toBe(450000);
    expect(result.estimatedPriceInr).toBe(4500);
    expect(result.currency).toBe('INR');
  });

  it('defaults truckType to medium_truck when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: 3000, currency: 'INR' })),
    });

    await predictPrice({ distanceKm: 100, cargoWeightKg: 500 });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.truck_type).toBe('medium_truck');
  });

  it('prefers ML_ENGINE_URL over ML_SERVICE_URL for price prediction', async () => {
    process.env.ML_ENGINE_URL = 'http://demand-service:8001';
    process.env.ML_SERVICE_URL = 'http://price-service:8002';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: 2000, currency: 'INR' })),
    });

    await predictPrice({ distanceKm: 50, cargoWeightKg: 200 });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('demand-service:8001');
    delete process.env.ML_ENGINE_URL;
    delete process.env.ML_SERVICE_URL;
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
      .toThrow('[ML] Authentication failed (403)');
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
      .toThrow('[ML] Request failed (502)');
  });

  it('rejects when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('Connection refused');
  });

  it('rejects NaN predicted price from ML engine (serialized as null by JSON)', async () => {
    // JSON.stringify({estimated_price: NaN}) produces {"estimated_price":null}
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: null, currency: 'INR' })),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.any(String) }),
      expect.stringContaining('rejected by validator'),
    );
  });

  it('rejects Infinity predicted price from ML engine (serialized as null by JSON)', async () => {
    // JSON.stringify({estimated_price: Infinity}) produces {"estimated_price":null}
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: null, currency: 'INR' })),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction');
  });

  it('rejects negative predicted price from ML engine', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: -500, currency: 'INR' })),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction: negative');
  });

  it('rejects null response from ML engine', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('null'),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction: null_response');
  });

  it('rejects response with missing estimated_price field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ currency: 'INR', min_price: 1000 })),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction: missing_field');
  });

  it('rejects response with missing currency field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: 5000 })),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction: missing_field');
  });

  it('rejects response with price above maximum', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: 999999, currency: 'INR' })),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction: above_maximum');
  });

  it('rejects response with price below minimum', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: 10, currency: 'INR' })),
    });

    await expect(predictPrice({ distanceKm: 100, cargoWeightKg: 500 }))
      .rejects
      .toThrow('[ML] Invalid prediction: below_minimum');
  });

  it('accepts valid response and returns estimatedPricePaisa', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ estimated_price: 3000, currency: 'INR' })),
    });

    const result = await predictPrice({ distanceKm: 100, cargoWeightKg: 500 });
    expect(result.estimatedPricePaisa).toBe(300000);
    expect(result.estimatedPriceInr).toBe(3000);
    expect(result.estimated_price).toBe(3000);
    expect(result.currency).toBe('INR');
  });
});

describe('ml service — predictEta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends correct payload shape matching ETAPredictInput schema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ eta_minutes: 45, confidence_interval: { lower: 40, upper: 50 } })),
    });

    const result = await predictEta({
      routeDistance: 250,
      timeOfDay: 14,
      dayOfWeek: 3,
      routeType: 'highway',
      historicalSpeed: 65,
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      route_distance: 250,
      time_of_day: 14,
      day_of_week: 3,
      route_type: 'highway',
      historical_speed: 65,
    });
    expect(result.eta_minutes).toBe(45);
    expect(result.confidence_interval.lower).toBe(40);
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(predictEta({
      routeDistance: 100, timeOfDay: 10, dayOfWeek: 1, routeType: 'city', historicalSpeed: 30,
    })).rejects.toThrow('[ML] ML_API_KEY is not configured');
  });

  it('throws on invalid response — missing eta_minutes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ confidence_interval: {} })),
    });

    await expect(predictEta({
      routeDistance: 100, timeOfDay: 10, dayOfWeek: 1, routeType: 'city', historicalSpeed: 30,
    })).rejects.toThrow('[ML] Invalid ETA prediction');
  });

  it('throws on non-finite eta_minutes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ eta_minutes: null, confidence_interval: {} })),
    });

    await expect(predictEta({
      routeDistance: 100, timeOfDay: 10, dayOfWeek: 1, routeType: 'city', historicalSpeed: 30,
    })).rejects.toThrow('[ML] Invalid ETA prediction');
  });

  it('provides default confidence_interval when missing from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ eta_minutes: 30 })),
    });

    const result = await predictEta({
      routeDistance: 100, timeOfDay: 10, dayOfWeek: 1, routeType: 'city', historicalSpeed: 30,
    });
    expect(result.eta_minutes).toBe(30);
    expect(result.confidence_interval).toEqual({ lower: 0, upper: 0 });
  });

  it('throws with descriptive message on 401 auth failure', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 401, ok: false, text: () => Promise.resolve('Invalid API key'),
    });

    await expect(predictEta({
      routeDistance: 100, timeOfDay: 10, dayOfWeek: 1, routeType: 'city', historicalSpeed: 30,
    })).rejects.toThrow('[ML] Authentication failed (401)');
  });
});

describe('ml service — matchBilateral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends loads and drivers arrays matching BilateralMatchInput schema', async () => {
    const loads = [
      {
        origin_lat: 28.61, origin_lng: 77.23,
        dest_lat: 19.08, dest_lng: 72.88,
        weight_kg: 5000, length_m: 6, width_m: 2.5, height_m: 2,
        deadline_hours: 48,
      },
    ];
    const drivers = [
      {
        current_lat: 28.61, current_lng: 77.23,
        max_weight_kg: 10000, max_length_m: 7, max_width_m: 2.5, max_height_m: 2.5,
        preferred_dest_lat: 19.08, preferred_dest_lng: 72.88,
        rating: 4.5,
      },
    ];

    const mockResponse = { assignments: [{ load_index: 0, driver_index: 0, match_score: 0.92 }], unmatched_loads: [], unmatched_drivers: [] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await matchBilateral({ loads, drivers });

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ loads, drivers });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].match_score).toBe(0.92);
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(matchBilateral({ loads: [], drivers: [] })).rejects.toThrow('[ML] ML_API_KEY is not configured');
  });

  it('throws with descriptive message on 500 response', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 500, ok: false, text: () => Promise.resolve('Model not loaded'),
    });

    await expect(matchBilateral({
      loads: [{ origin_lat: 1, origin_lng: 1, dest_lat: 2, dest_lng: 2, weight_kg: 100, length_m: 1, width_m: 1, height_m: 1, deadline_hours: 24 }],
      drivers: [{ current_lat: 1, current_lng: 1, max_weight_kg: 500, max_length_m: 2, max_width_m: 2, max_height_m: 2, rating: 4 }],
    })).rejects.toThrow('[ML] Request failed (500)');
  });
});

describe('ml service — predictDriverProfit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends correct payload matching DriverProfitInput schema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ predicted_profit: 12500.5, confidence_interval: { lower: 10000, upper: 15000 } })),
    });

    const result = await predictDriverProfit({
      routeDistanceKm: 500,
      fuelPricePerLitre: 105,
      tollEstimateInr: 1200,
      truckMileageKmL: 4,
      cargoWeightKg: 8000,
      tripDurationHours: 10,
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      route_distance: 500,
      fuel_price: 105,
      toll_estimate: 1200,
      truck_mileage: 4,
      cargo_weight: 8000,
      trip_duration: 10,
    });
    expect(result.predicted_profit).toBe(12500.5);
    expect(result.confidence_interval.lower).toBe(10000);
    expect(result.currency).toBe('INR');
  });

  it('throws on missing predicted_profit in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ confidence_interval: {} })),
    });

    await expect(predictDriverProfit({
      routeDistanceKm: 100, fuelPricePerLitre: 100, tollEstimateInr: 0, truckMileageKmL: 5, cargoWeightKg: 1000, tripDurationHours: 2,
    })).rejects.toThrow('[ML] Invalid driver profit prediction');
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(predictDriverProfit({
      routeDistanceKm: 100, fuelPricePerLitre: 100, tollEstimateInr: 0, truckMileageKmL: 5, cargoWeightKg: 1000, tripDurationHours: 2,
    })).rejects.toThrow('[ML] ML_API_KEY is not configured');
  });
});

describe('ml service — optimisePacking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends packages, truck, and delivery_addresses matching PackingInput schema', async () => {
    const packages = [
      { length: 1.2, width: 0.8, height: 0.6, weight: 50 },
      { length: 0.5, width: 0.5, height: 0.5, weight: 20 },
    ];
    const truck = { length: 6, width: 2.5, height: 2.5, max_weight: 10000 };
    const deliveryAddresses = [
      { lat: 28.61, lng: 77.23 },
      { lat: 19.08, lng: 72.88 },
    ];

    const mockResponse = {
      packing_arrangement: [{ package_index: 0, position: { x: 0, y: 0, z: 0 } }],
      unpacked_packages: [],
      stop_sequence: [0, 1],
      utilization_pct: 85.5,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await optimisePacking({ packages, truck, deliveryAddresses });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.packages).toEqual(packages);
    expect(body.truck).toEqual(truck);
    expect(body.delivery_addresses).toEqual(deliveryAddresses);
    expect(result.utilization_pct).toBe(85.5);
    expect(result.stop_sequence).toEqual([0, 1]);
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(optimisePacking({ packages: [], truck: { length: 1, width: 1, height: 1, max_weight: 1 }, deliveryAddresses: [] }))
      .rejects.toThrow('[ML] ML_API_KEY is not configured');
  });
});

describe('ml service — recommendLoads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends userId, booking_history, rated_drivers, top_n matching RecommendLoadsInput schema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ recommendations: [{ load_id: 'L001', score: 0.95 }] })),
    });

    const result = await recommendLoads({
      userId: 'user-123',
      bookingHistory: [{ load_id: 'L001', rating: 5 }],
      ratedDrivers: [{ driver_id: 'D001', rating: 4 }],
      topN: 3,
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.user_id).toBe('user-123');
    expect(body.booking_history).toEqual([{ load_id: 'L001', rating: 5 }]);
    expect(body.rated_drivers).toEqual([{ driver_id: 'D001', rating: 4 }]);
    expect(body.top_n).toBe(3);
    expect(result.recommendations).toHaveLength(1);
  });

  it('uses defaults for optional parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ recommendations: [] })),
    });

    await recommendLoads({ userId: 'user-123' });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.booking_history).toEqual([]);
    expect(body.rated_drivers).toEqual([]);
    expect(body.top_n).toBe(5);
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(recommendLoads({ userId: 'user-123' })).rejects.toThrow('[ML] ML_API_KEY is not configured');
  });
});

describe('ml service — recommendTrucks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends userId, booking_history, rated_loads, top_n matching RecommendTrucksInput schema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ recommendations: [{ truck_id: 'T001', score: 0.88 }] })),
    });

    const result = await recommendTrucks({
      userId: 'user-456',
      bookingHistory: [{ load_id: 'L002', rating: 4 }],
      ratedLoads: [{ load_id: 'L002', rating: 4 }],
      topN: 10,
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.user_id).toBe('user-456');
    expect(body.booking_history).toEqual([{ load_id: 'L002', rating: 4 }]);
    expect(body.rated_loads).toEqual([{ load_id: 'L002', rating: 4 }]);
    expect(body.top_n).toBe(10);
    expect(result.recommendations).toHaveLength(1);
  });

  it('uses defaults for optional parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ recommendations: [] })),
    });

    await recommendTrucks({ userId: 'user-456' });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.booking_history).toEqual([]);
    expect(body.rated_loads).toEqual([]);
    expect(body.top_n).toBe(5);
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(recommendTrucks({ userId: 'user-456' })).rejects.toThrow('[ML] ML_API_KEY is not configured');
  });
});

describe('ml service — scoreTrust', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends behavioral metrics matching TrustScoreInput schema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ trust_score: 0.85, risk_category: 'low' })),
    });

    const result = await scoreTrust({
      cancellationRate: 0.05,
      onTimePct: 95,
      avgRating: 4.5,
      disputeCount: 1,
      isVerified: true,
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      cancellation_rate: 0.05,
      on_time_pct: 95,
      avg_rating: 4.5,
      dispute_count: 1,
      is_verified: true,
    });
    expect(result.trust_score).toBe(0.85);
    expect(result.risk_category).toBe('low');
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(scoreTrust({
      cancellationRate: 0, onTimePct: 100, avgRating: 5, disputeCount: 0, isVerified: true,
    })).rejects.toThrow('[ML] ML_API_KEY is not configured');
  });
});

describe('ml service — matchDeadhead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    process.env.ML_API_KEY = 'test_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends driver_destination, truck_specs, arrival_time, available_loads matching DeadheadInput schema', async () => {
    const params = {
      driverDestination: { lat: 28.61, lng: 77.23 },
      truckSpecs: { max_weight_kg: 10000, max_length_m: 7, max_width_m: 2.5, max_height_m: 2.5 },
      arrivalTime: '2026-07-20T14:00:00Z',
      availableLoads: [
        {
          load_id: 'L001',
          origin_lat: 19.08, origin_lng: 72.88,
          dest_lat: 28.61, dest_lng: 77.23,
          weight_kg: 5000, length_m: 6, width_m: 2.5, height_m: 2,
          pickup_deadline: '2026-07-21T14:00:00Z',
          payment_inr: 15000,
        },
      ],
    };

    const mockResponse = { recommendations: [{ load_id: 'L001', revenue: 15000, empty_km_saved: 1200 }] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await matchDeadhead(params);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.driver_destination).toEqual(params.driverDestination);
    expect(body.truck_specs).toEqual(params.truckSpecs);
    expect(body.arrival_time).toBe(params.arrivalTime);
    expect(body.available_loads).toEqual(params.availableLoads);
    expect(result.recommendations).toHaveLength(1);
  });

  it('throws on missing ML_API_KEY', async () => {
    delete process.env.ML_API_KEY;
    await expect(matchDeadhead({
      driverDestination: { lat: 0, lng: 0 },
      truckSpecs: { max_weight_kg: 1, max_length_m: 1, max_width_m: 1, max_height_m: 1 },
      arrivalTime: '2026-01-01T00:00:00Z',
      availableLoads: [],
    })).rejects.toThrow('[ML] ML_API_KEY is not configured');
  });
});
