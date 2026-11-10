import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return global.__maSupabase; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createSupabaseMock } = await import('../helpers/supabaseMock.js');
const {
  aggregateDriverUtilization,
  aggregateRouteEfficiency,
  aggregateDeliveryPerformance,
  AnalyticsRangeTooLargeError,
  MAX_ANALYTICS_ROWS,
} = await import('../../src/lib/metricsAggregator.js');

function telemetryRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    driver_id: 'd1',
    total_distance_km: 1,
    active_hours: 1,
    idle_hours: 0,
    total_pings: 1,
    date: '2026-10-01',
    fleet_manager_id: 'fm1',
  }));
}

function orderRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `order-${index}`,
    driver_id: 'd1',
    planned_distance_km: 10,
    actual_distance_km: 10,
    fuel_cost_paisa: 100,
    total_amount: 1000,
    status: 'completed',
    completed_at: '2026-10-01T12:00:00.000Z',
    estimated_delivery_at: '2026-10-01T12:00:00.000Z',
    customer_rating: 5,
    fleet_manager_id: 'fm1',
  }));
}

describe('aggregateDriverUtilization', () => {
  beforeEach(() => { global.__maSupabase = null; });

  it('groups telemetry rows per driver with rounded totals + utilization %', async () => {
    const mock = createSupabaseMock({
      driver_telemetry_daily: [
        { driver_id: 'd1', total_distance_km: 100.125, active_hours: 6, idle_hours: 2, total_pings: 50, date: '2026-10-01', fleet_manager_id: 'fm1' },
        { driver_id: 'd1', total_distance_km: 200, active_hours: 2, idle_hours: 6, total_pings: 30, date: '2026-10-02', fleet_manager_id: 'fm1' },
        { driver_id: 'd2', total_distance_km: 50, active_hours: 8, idle_hours: 0, total_pings: 80, date: '2026-10-01', fleet_manager_id: 'fm1' },
      ],
    });
    global.__maSupabase = mock.supabase;

    const res = await aggregateDriverUtilization('fm1', '2026-10-01', '2026-10-31');
    expect(res).toHaveLength(2);
    const d1 = res.find((r) => r.driverId === 'd1');
    expect(d1.totalDistanceKm).toBe(300.13); // rounded to 2dp
    expect(d1.daysTracked).toBe(2);
    expect(d1.utilizationPct).toBe(50); // 8 active of 16 total
    const d2 = res.find((r) => r.driverId === 'd2');
    expect(d2.utilizationPct).toBe(100);
  });

  it('utilization is 0 when a driver has no tracked hours (no division by zero)', async () => {
    const mock = createSupabaseMock({
      driver_telemetry_daily: [
        { driver_id: 'd9', total_distance_km: 10, active_hours: 0, idle_hours: 0, total_pings: 3, date: '2026-10-01', fleet_manager_id: 'fm1' },
      ],
    });
    global.__maSupabase = mock.supabase;
    const res = await aggregateDriverUtilization('fm1', '2026-10-01', '2026-10-31');
    expect(res[0].utilizationPct).toBe(0);
  });

  it('empty result set → empty list; supabaseAdmin unset → empty list', async () => {
    global.__maSupabase = createSupabaseMock({}).supabase;
    expect(await aggregateDriverUtilization('fm1', '2026-10-01', '2026-10-31')).toEqual([]);
    global.__maSupabase = null;
    expect(await aggregateDriverUtilization('fm1', '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('database errors degrade to [] rather than throwing', async () => {
    const mock = createSupabaseMock({});
    mock.supabase.from = () => {
      throw new Error('connection lost');
    };
    global.__maSupabase = mock.supabase;
    expect(await aggregateDriverUtilization('fm1', '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('accepts exactly the maximum row count and requests one extra row to detect overflow', async () => {
    const mock = createSupabaseMock({ driver_telemetry_daily: telemetryRows(MAX_ANALYTICS_ROWS) });
    global.__maSupabase = mock.supabase;

    const res = await aggregateDriverUtilization('fm1', '2026-10-01', '2026-10-31');

    expect(res).toHaveLength(1);
    expect(res[0].totalDistanceKm).toBe(MAX_ANALYTICS_ROWS);
    expect(mock.calls[0].limit).toBe(MAX_ANALYTICS_ROWS + 1);
  });

  it('throws AnalyticsRangeTooLargeError when driver telemetry exceeds the maximum', async () => {
    const mock = createSupabaseMock({ driver_telemetry_daily: telemetryRows(MAX_ANALYTICS_ROWS + 1) });
    global.__maSupabase = mock.supabase;

    await expect(aggregateDriverUtilization('fm1', '2026-10-01', '2026-10-31'))
      .rejects.toBeInstanceOf(AnalyticsRangeTooLargeError);
  });

  it.each([
    ['route efficiency', aggregateRouteEfficiency],
    ['delivery performance', aggregateDeliveryPerformance],
  ])('throws AnalyticsRangeTooLargeError when %s exceeds the maximum', async (_label, aggregate) => {
    const mock = createSupabaseMock({ orders: orderRows(MAX_ANALYTICS_ROWS + 1) });
    global.__maSupabase = mock.supabase;

    await expect(aggregate('fm1', '2026-10-01', '2026-10-31'))
      .rejects.toBeInstanceOf(AnalyticsRangeTooLargeError);
  });
});
