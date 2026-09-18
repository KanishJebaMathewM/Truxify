import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('axios');

import axios from 'axios';
import {
  optimizeWaypoints,
  optimizeLtlRoute,
  getHaversineDistance,
  getDriverRoute,
} from '../../src/services/routingService.js';
import { DomainError } from '../../src/services/order/domainError.js';

const mockAxiosGet = vi.mocked(axios.get);

describe('routingService - getHaversineDistance', () => {
  it('returns 0 for identical points', () => {
    const result = getHaversineDistance(12.9716, 77.5946, 12.9716, 77.5946);
    expect(result).toBe(0);
  });

  it('returns approximate distance between two known cities', () => {
    // Bangalore to Chennai: ~290 km
    const result = getHaversineDistance(12.9716, 77.5946, 13.0827, 80.2707);
    expect(result).toBeGreaterThan(280);
    expect(result).toBeLessThan(310);
  });

  it('returns approximately 20000 km for antipodal points', () => {
    // North Pole to South Pole (~20015 km)
    const result = getHaversineDistance(90, 0, -90, 0);
    expect(result).toBeGreaterThan(19900);
    expect(result).toBeLessThan(20100);
  });

  it('handles negative coordinates', () => {
    // Mumbai to Cape Town: ~8240 km
    const result = getHaversineDistance(19.0760, 72.8777, -33.9249, 18.4241);
    expect(result).toBeGreaterThan(8000);
    expect(result).toBeLessThan(8500);
  });
});

describe('routingService - optimizeWaypoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosGet.mockReset();
  });

  it('returns empty array when waypoints is empty', async () => {
    const result = await optimizeWaypoints(
      { lat: 0, lng: 0, address: 'Start' },
      { lat: 1, lng: 1, address: 'End' },
      []
    );
    expect(result).toEqual([]);
  });

  it('returns original waypoint array when only one waypoint', async () => {
    const wp = [{ lat: 13, lng: 77, address: 'Only' }];
    const result = await optimizeWaypoints(
      { lat: 0, lng: 0, address: 'Start' },
      { lat: 1, lng: 1, address: 'End' },
      wp
    );
    expect(result).toEqual(wp);
  });

  it('falls back to original order when OSRM returns non-Ok code', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { code: 'NoRoute' } });

    const wp = [
      { lat: 13, lng: 77, address: 'A' },
      { lat: 14, lng: 78, address: 'B' },
    ];
    const result = await optimizeWaypoints(
      { lat: 0, lng: 0, address: 'Start' },
      { lat: 20, lng: 90, address: 'End' },
      wp
    );
    expect(result).toEqual(wp);
  });

  it('falls back to original order when waypointsResult is empty', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { code: 'Ok', waypoints: [] } });

    const wp = [
      { lat: 13, lng: 77, address: 'A' },
      { lat: 14, lng: 78, address: 'B' },
    ];
    const result = await optimizeWaypoints(
      { lat: 0, lng: 0, address: 'Start' },
      { lat: 20, lng: 90, address: 'End' },
      wp
    );
    expect(result).toEqual(wp);
  });

  it('falls back to original order when axios throws', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('Network failure'));

    const wp = [
      { lat: 13, lng: 77, address: 'A' },
      { lat: 14, lng: 78, address: 'B' },
    ];
    const result = await optimizeWaypoints(
      { lat: 0, lng: 0, address: 'Start' },
      { lat: 20, lng: 90, address: 'End' },
      wp
    );
    expect(result).toEqual(wp);
  });

  it('reorders waypoints based on OSRM waypoint_index values', async () => {
    // OSRM Trip API returns waypoints in INPUT order; each waypoint's
    // `waypoint_index` is its position in the optimized trip.
    // Input coords: [start(0), WP1(1), WP2(2), WP3(3), end(4)]
    // Trip order: start, WP3, WP1, WP2, end
    // waypoint_indices in input order: 0 (start), 2 (WP1), 3 (WP2), 1 (WP3), 4 (end)
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        waypoints: [
          { waypoint_index: 0 },
          { waypoint_index: 2 },
          { waypoint_index: 3 },
          { waypoint_index: 1 },
          { waypoint_index: 4 },
        ],
      },
    });

    const wp1 = { lat: 14, lng: 78, address: 'WP1' };
    const wp2 = { lat: 15, lng: 79, address: 'WP2' };
    const wp3 = { lat: 16, lng: 80, address: 'WP3' };
    const wp = [wp1, wp2, wp3]; // input order

    const result = await optimizeWaypoints(
      { lat: 0, lng: 0, address: 'Start' },
      { lat: 20, lng: 90, address: 'End' },
      wp
    );
    // Trip order of the middle stops: WP3, WP1, WP2
    expect(result).toEqual([wp3, wp1, wp2]);
    expect(result).toHaveLength(wp.length);
    expect(result.every(waypoint => waypoint !== undefined)).toBe(true);
  });

  it('calls OSRM Trip API with correct coordinates', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        code: 'Ok',
        waypoints: [
          { waypoint_index: 0 },
          { waypoint_index: 2 },
          { waypoint_index: 1 },
          { waypoint_index: 3 },
        ],
      },
    });

    await optimizeWaypoints(
      { lat: 12.97, lng: 77.59, address: 'Start' },
      { lat: 13.08, lng: 80.27, address: 'End' },
      [{ lat: 14.00, lng: 78.00, address: 'WP1' }, { lat: 15.00, lng: 79.00, address: 'WP2' }]
    );

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    const callUrl = mockAxiosGet.mock.calls[0][0];
    expect(callUrl).toContain('77.59,12.97'); // start: lng,lat
    expect(callUrl).toContain('78,14');        // WP1: lng,lat
    expect(callUrl).toContain('79,15');         // WP2: lng,lat
    expect(callUrl).toContain('80.27,13.08'); // end: lng,lat
    expect(callUrl).toContain('/trip/v1/driving/');
  });
});

describe('routingService - optimizeLtlRoute', () => {
  it('returns tasks as-is when 0 or 1 tasks', () => {
    expect(optimizeLtlRoute(0, 0, [])).toEqual([]);
    expect(optimizeLtlRoute(0, 0, null)).toBeNull();
    expect(optimizeLtlRoute(0, 0, undefined)).toBeUndefined();

    const single = [{ id: 't1', orderId: 'o1', type: 'pickup', lat: 1, lng: 1 }];
    expect(optimizeLtlRoute(0, 0, single)).toBe(single);
  });

  it('respects pickup-before-dropoff precedence constraint', () => {
    // Dropoff for order o1 appears before pickup for o1 in input
    const tasks = [
      { id: 'd1', orderId: 'o1', type: 'dropoff', lat: 10, lng: 10 },
      { id: 'p1', orderId: 'o1', type: 'pickup', lat: 5, lng: 5 },
    ];

    const result = optimizeLtlRoute(0, 0, tasks);

    // Dropoff must appear after its pickup in the result
    const p1Idx = result.findIndex(t => t.id === 'p1');
    const d1Idx = result.findIndex(t => t.id === 'd1');
    expect(p1Idx).toBeLessThan(d1Idx);
  });

  it('skips dropoff when pickup not yet visited and not in task list', () => {
    // Only dropoff for order o1, no pickup in tasks
    const tasks = [
      { id: 'd1', orderId: 'o1', type: 'dropoff', lat: 10, lng: 10 },
      { id: 'p2', orderId: 'o2', type: 'pickup', lat: 5, lng: 5 },
    ];

    const result = optimizeLtlRoute(0, 0, tasks);

    // o1's dropoff was skipped (no pickup in tasks)
    // Driver goes to o2's pickup first
    expect(result[0].id).toBe('p2');
    expect(result.some(t => t.id === 'd1')).toBe(true);
  });

  it('selects nearest task by haversine distance', () => {
    const tasks = [
      { id: 'far', orderId: 'o1', type: 'pickup', lat: 20, lng: 20 },
      { id: 'near', orderId: 'o2', type: 'pickup', lat: 1, lng: 1 },
    ];

    const result = optimizeLtlRoute(0, 0, tasks);
    expect(result[0].id).toBe('near');
  });

  it('appends tasks with no reachable dropoff (no prior pickup) at the end', () => {
    const tasks = [
      { id: 'd_orphan', orderId: 'orphan', type: 'dropoff', lat: 5, lng: 5 },
      { id: 'p1', orderId: 'o1', type: 'pickup', lat: 1, lng: 1 },
    ];
    const result = optimizeLtlRoute(0, 0, tasks);
    expect(result[result.length - 1].id).toBe('d_orphan');
  });

  it('appends unvisited tasks as failsafe', () => {
    // Create a situation where no nearest task is found
    const tasks = [
      { id: 'p1', orderId: 'o1', type: 'pickup', lat: 5, lng: 5 },
      { id: 'd1', orderId: 'o1', type: 'dropoff', lat: 10, lng: 10 },
    ];

    const result = optimizeLtlRoute(0, 0, tasks);
    expect(result.length).toBe(2);
    expect(result.every(t => tasks.includes(t))).toBe(true);
  });
});


describe('routingService - non-finite getHaversineDistance guard', () => {
  it('should throw TypeError when non-finite coordinates are passed to getHaversineDistance', () => {
    expect(() => getHaversineDistance(NaN, 77.2090, 27.1767, 78.0081)).toThrow(TypeError);
    expect(() => getHaversineDistance(28.6139, Infinity, 27.1767, 78.0081)).toThrow(TypeError);
    expect(() => getHaversineDistance(28.6139, 77.2090, undefined, 78.0081)).toThrow(TypeError);
  });
});

describe('routingService - getDriverRoute', () => {
  it('returns null early for null, undefined, empty, or non-string driverId', async () => {
    expect(await getDriverRoute(null)).toBeNull();
    expect(await getDriverRoute(undefined)).toBeNull();
    expect(await getDriverRoute('')).toBeNull();
    expect(await getDriverRoute('   ')).toBeNull();
    expect(await getDriverRoute(12345)).toBeNull();
  });

  it('throws DomainError when throwOnError option is set and driverId is null/invalid', async () => {
    await expect(getDriverRoute(null, { throwOnError: true })).rejects.toThrow(DomainError);
    await expect(getDriverRoute(undefined, { throwOnError: true })).rejects.toThrow(/driverId is required/);
    await expect(getDriverRoute('', { throwOnError: true })).rejects.toThrow(DomainError);
  });

  it('fetches driver active route using provided supabase client', async () => {
    const mockOrder = {
      id: 'order-123',
      order_display_id: 'TRX-100',
      status: 'in_transit',
      pickup_address: 'Delhi',
      drop_address: 'Jaipur',
      pickup_lat: 28.61,
      pickup_lng: 77.20,
      drop_lat: 26.91,
      drop_lng: 75.78,
    };

    const mockChain = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
    };

    const result = await getDriverRoute('driver-456', { supabaseClient: mockChain });
    expect(result).toEqual(mockOrder);
    expect(mockChain.eq).toHaveBeenCalledWith('driver_id', 'driver-456');
  });

  it('handles database error gracefully when throwOnError is false', async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB connection error' } }),
    };

    const result = await getDriverRoute('driver-456', { supabaseClient: mockChain });
    expect(result).toBeNull();
  });
});