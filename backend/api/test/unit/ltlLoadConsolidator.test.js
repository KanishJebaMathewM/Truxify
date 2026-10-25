import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const axios = (await import('axios')).default;
const { createSupabaseMock } = await import('../../test/helpers/supabaseMock.js');
const { LtlLoadConsolidatorService } = await import('../../src/services/ltlLoadConsolidatorService.js');

const booking = (id, kg = 500) => ({
  id, weight_kg: kg,
  pickup_lat: 28.61, pickup_lng: 77.20, pickup_address: `Pickup ${id}`,
  drop_lat: 28.70, drop_lng: 77.30, drop_address: `Drop ${id}`,
});

const mlSolution = {
  success: true,
  packing_solution: {
    statistics: {
      total_packed_weight_kg: 1000, volume_utilization_pct: 62.5,
      weight_utilization_pct: 4.0, center_of_gravity_x_m: 3.1, is_axle_balanced: true,
    },
    packed_items: [{ id: 'b1_item_1' }, { id: 'b2_item_1' }],
    unpacked_items: [],
  },
  routing_solution: {
    total_distance_km: 42.5, total_duration_hours: 1.5,
    itinerary: [
      { consignment_id: 'b1', type: 'PICKUP', sequence: 1 },
      { consignment_id: 'b1', type: 'DELIVERY', sequence: 2 },
      { consignment_id: 'b2', type: 'PICKUP', sequence: 3 },
      { consignment_id: 'b2', type: 'DELIVERY', sequence: 4 },
    ],
  },
};

describe('LtlLoadConsolidatorService.consolidateBookings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects fewer than 2 candidate bookings', async () => {
    const svc = new LtlLoadConsolidatorService({ supabase: null });
    await expect(svc.consolidateBookings({ driverId: 'd1', candidateBookings: [booking('b1')] }))
      .rejects.toThrow(/At least 2/);
    await expect(svc.consolidateBookings({ candidateBookings: [booking('b1'), booking('b2')] }))
      .rejects.toThrow(/At least 2/);
  });

  it('happy path: formats consignments, persists parent + children, returns the summary', async () => {
    axios.post.mockResolvedValue({ data: mlSolution });
    const mock = createSupabaseMock({});
    // the mock returns a synthetic id for inserted rows — no programming needed
    const svc = new LtlLoadConsolidatorService({ supabase: mock.supabase, mlServiceUrl: 'http://ml.test' });

    const res = await svc.consolidateBookings({
      driverId: 'd1', vehicleRegistration: 'MH01AB1234', candidateBookings: [booking('b1'), booking('b2')],
    });

    expect(res.success).toBe(true);
    expect(res.totalDistanceKm).toBe(42.5);
    expect(res.packingSummary.volumeUtilizationPct).toBe(62.5);
    expect(res.packedItemsCount).toBe(2);

    // ML payload shape
    const payload = axios.post.mock.calls[0][1];
    expect(payload.consignments).toHaveLength(2);
    expect(payload.consignments[0].pickup.name).toBe('Pickup b1');
    expect(payload.truck_specs.max_weight_kg).toBe(25000); // default

    // parent + children persisted
    expect(mock.store.composite_trips[0].total_consignments).toBe(2);
    expect(res.compositeTripId).toMatch(/^mock-composite_trips-/);
    expect(mock.store.trip_consignments).toHaveLength(2);
    expect(mock.store.trip_consignments[0].pickup_stop_sequence).toBe(1);
    expect(mock.store.trip_consignments[1].delivery_stop_sequence).toBe(4);
  });

  it('ML failure (success:false) throws with the physical-feasibility message', async () => {
    axios.post.mockResolvedValue({ data: { success: false } });
    const svc = new LtlLoadConsolidatorService({ supabase: null });
    await expect(svc.consolidateBookings({ driverId: 'd1', candidateBookings: [booking('b1'), booking('b2')] }))
      .rejects.toThrow(/exceeds physical space/);
  });

  it('ML unreachable propagates the axios error (no silent composite trip)', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = new LtlLoadConsolidatorService({ supabase: null });
    await expect(svc.consolidateBookings({ driverId: 'd1', candidateBookings: [booking('b1'), booking('b2')] }))
      .rejects.toThrow('ECONNREFUSED');
  });

  it('parent persistence failure still returns the solution (logs, continues)', async () => {
    axios.post.mockResolvedValue({ data: mlSolution });
    const mock = createSupabaseMock({});
    mock.programErrorFor('composite_trips', 'insert', 'constraint violation');
    const svc = new LtlLoadConsolidatorService({ supabase: mock.supabase });
    const res = await svc.consolidateBookings({ driverId: 'd1', candidateBookings: [booking('b1'), booking('b2')] });
    expect(res.success).toBe(true);
    expect(res.compositeTripId).toBeNull();
  });
});
