import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/order/bidAcceptanceService.js', () => ({
  DomainError: class DomainError extends Error {},
}));
vi.mock('../../src/services/ml.js', () => ({
  predictPrice: vi.fn(),
}));

function makeBuilder(result) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    not() { return this; },
    in() { return this; },
    then(resolve) { return resolve(result); },
  };
  return builder;
}

const rpcMock = vi.fn();
const resultsByTable = {
  driver_details: {
    data: [
      { user_id: 'driver-1', truck_id: 'truck-1' },
      { user_id: 'driver-2', truck_id: 'truck-2' },
    ],
    error: null,
  },
  trucks: {
    data: [
      { id: 'truck-1', max_capacity_tons: 10 },
      { id: 'truck-2', max_capacity_tons: 2 },
    ],
    error: null,
  },
};

const supabaseAdminBuilder = {
  from: vi.fn((table) => makeBuilder(resultsByTable[table] ?? { data: [], error: null })),
  rpc: rpcMock,
};
const supabaseAnonBuilder = {
  from: vi.fn(() => makeBuilder({ data: [], error: null })),
  rpc: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseAnonBuilder,
  supabaseAdmin: supabaseAdminBuilder,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('findTargetDrivers', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    supabaseAdminBuilder.from.mockClear();
    supabaseAnonBuilder.from.mockClear();
  });

  it('queries nearby drivers via the get_nearby_active_drivers RPC on the service-role client, not a full-table scan on the anon client', async () => {
    rpcMock.mockResolvedValue({
      data: [{ driver_id: 'driver-1' }, { driver_id: 'driver-2' }],
      error: null,
    });

    const { findTargetDrivers } = await import('../../src/services/order/orderCreationService.js');

    const result = await findTargetDrivers({ pickupLat: 19.076, pickupLng: 72.8777, weightTonnes: 5 });

    expect(rpcMock).toHaveBeenCalledWith('get_nearby_active_drivers', expect.objectContaining({
      origin_lat: 19.076,
      origin_lng: 72.8777,
      radius_meters: expect.any(Number),
      freshness_seconds: expect.any(Number),
    }));
    expect(supabaseAnonBuilder.from).not.toHaveBeenCalled();
    expect(supabaseAdminBuilder.from).toHaveBeenCalledWith('driver_details');
    expect(supabaseAdminBuilder.from).toHaveBeenCalledWith('trucks');
    // driver-2's truck only carries 2 tons, below the 5-tonne load, so it's filtered out
    expect(result).toEqual(['driver-1']);
  });

  it('returns an empty list and logs instead of throwing when the RPC errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { findTargetDrivers } = await import('../../src/services/order/orderCreationService.js');

    const result = await findTargetDrivers({ pickupLat: 19.076, pickupLng: 72.8777, weightTonnes: 5 });

    expect(result).toEqual([]);
    expect(supabaseAdminBuilder.from).not.toHaveBeenCalled();
  });
});
