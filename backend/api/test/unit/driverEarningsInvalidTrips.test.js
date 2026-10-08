import { describe, it, expect } from 'vitest';
import { aggregateTripEarnings, calculateEarningsAggregation } from '../../src/services/driverEarningsService.js';

const trip = { total_earnings: 300, net_earnings: 240, status: 'completed', distance: '12 km' };
const invalid = [null, undefined, false, 42, 'trip', []];

describe('earnings summaries with invalid trip entries', () => {
  it.each(invalid.map((value) => [value]))('skips %s without changing totals or denominators', (value) => {
    expect(aggregateTripEarnings([trip, value])).toEqual(aggregateTripEarnings([trip]));
    expect(calculateEarningsAggregation([trip, value], [], 8))
      .toEqual(calculateEarningsAggregation([trip], [], 8));
  });

  it('returns zero summaries when every entry is invalid', () => {
    expect(aggregateTripEarnings(invalid)).toEqual(aggregateTripEarnings([]));
    expect(calculateEarningsAggregation(invalid, invalid, null))
      .toEqual(calculateEarningsAggregation([], [], null));
  });

  it('ignores sparse array holes in summary denominators', () => {
    const sparse = new Array(3);
    sparse[1] = trip;
    expect(aggregateTripEarnings(sparse)).toEqual(aggregateTripEarnings([trip]));
    expect(calculateEarningsAggregation(sparse, [], null))
      .toEqual(calculateEarningsAggregation([trip], [], null));
  });

  it('does not infer a deadhead connection across a missing trip', () => {
    const first = { ...trip, route_label: 'A → B', trip_date: '2026-09-28' };
    const second = { ...trip, route_label: 'B → C', trip_date: '2026-09-29' };
    expect(calculateEarningsAggregation([], [first, second], null).deadhead_trips_saved).toBe(1);
    expect(calculateEarningsAggregation([], [first, null, second], null).deadhead_trips_saved).toBe(0);
    expect(calculateEarningsAggregation([], [undefined, second], null).deadhead_trips_saved).toBe(0);
  });
});
