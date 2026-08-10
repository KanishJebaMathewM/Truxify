/**
 * Coverage for the driver earnings report aggregation.
 *
 * The handler previously ran three independent queries sequentially and
 * fetched the driver's entire completed trip history with no limit, purely to
 * count consecutive route pairs.
 */
import { describe, expect, it } from 'vitest';
import {
  DEADHEAD_COLUMNS,
  DEADHEAD_MAX_GAP_DAYS,
  DEADHEAD_MAX_ROWS,
  EARNINGS_TRIP_COLUMNS,
  buildWeeklyChart,
  countDeadheadTripsSaved,
  getDeadheadCutoff,
  getEarningsCutoff,
  parseDistanceKm,
  sumDistanceKm,
  sumEarnings,
  toDateKey,
} from '../../src/services/driver/earningsReportService.js';

/** Date offset from a fixed reference, as the trip_date column stores it. */
const BASE = new Date('2026-08-01T00:00:00.000Z');
function daysFrom(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

describe('column selection', () => {
  it('selects only the columns the response serialises', () => {
    // Replaces a select('*') that pulled every column of the widest table.
    for (const column of [
      'trip_display_id',
      'route_label',
      'trip_date',
      'distance',
      'total_earnings',
      'fuel_deducted',
      'net_earnings',
      'blockchain_hash',
    ]) {
      expect(EARNINGS_TRIP_COLUMNS).toContain(column);
    }
    expect(EARNINGS_TRIP_COLUMNS).not.toContain('*');
  });

  it('requests only what the deadhead scan needs', () => {
    expect(DEADHEAD_COLUMNS).toBe('route_label, trip_date');
  });

  it('caps the deadhead scan', () => {
    expect(DEADHEAD_MAX_ROWS).toBeGreaterThan(0);
    expect(Number.isFinite(DEADHEAD_MAX_ROWS)).toBe(true);
  });
});

describe('getEarningsCutoff', () => {
  it('returns midnight today for the day period', () => {
    const cutoff = getEarningsCutoff('day', new Date('2026-08-05T15:30:00'));
    expect(cutoff.getHours()).toBe(0);
    expect(cutoff.getMinutes()).toBe(0);
  });

  it('returns seven days back for the week period', () => {
    const now = new Date('2026-08-05T12:00:00');
    const cutoff = getEarningsCutoff('week', now);
    expect(Math.round((now - cutoff) / 86_400_000)).toBe(7);
  });

  it('returns thirty days back for the month period', () => {
    const now = new Date('2026-08-05T12:00:00');
    const cutoff = getEarningsCutoff('month', now);
    expect(Math.round((now - cutoff) / 86_400_000)).toBe(30);
  });

  it('returns null for an unrecognised period so the route can 400', () => {
    expect(getEarningsCutoff('year')).toBeNull();
    expect(getEarningsCutoff('')).toBeNull();
    expect(getEarningsCutoff(undefined)).toBeNull();
  });
});

describe('getDeadheadCutoff', () => {
  it('extends the window back by exactly the adjacency gap', () => {
    const cutoff = new Date('2026-08-05T00:00:00');
    const deadhead = getDeadheadCutoff(cutoff);
    expect(Math.round((cutoff - deadhead) / 86_400_000)).toBe(DEADHEAD_MAX_GAP_DAYS);
  });

  it('does not mutate the cutoff it is given', () => {
    const cutoff = new Date('2026-08-05T00:00:00');
    const before = cutoff.getTime();
    getDeadheadCutoff(cutoff);
    expect(cutoff.getTime()).toBe(before);
  });
});

describe('parseDistanceKm', () => {
  it('extracts kilometres from a free-text distance', () => {
    expect(parseDistanceKm('420 km')).toBe(420);
    expect(parseDistanceKm('1,250 km')).toBe(1250);
  });

  it('accepts a plain number', () => {
    expect(parseDistanceKm(420)).toBe(420);
  });

  it('returns 0 for null, undefined and empty values', () => {
    expect(parseDistanceKm(null)).toBe(0);
    expect(parseDistanceKm(undefined)).toBe(0);
    expect(parseDistanceKm('')).toBe(0);
  });

  it('returns 0 when the value contains no digits', () => {
    expect(parseDistanceKm('unknown')).toBe(0);
    expect(parseDistanceKm('km')).toBe(0);
  });
});

describe('sumDistanceKm', () => {
  it('totals distances across trips', () => {
    expect(sumDistanceKm([{ distance: '420 km' }, { distance: '310 km' }])).toBe(730);
  });

  it('skips unparseable distances rather than producing NaN', () => {
    const total = sumDistanceKm([{ distance: '420 km' }, { distance: null }, { distance: 'n/a' }]);
    expect(total).toBe(420);
  });

  it('returns 0 for empty or non-array input', () => {
    expect(sumDistanceKm([])).toBe(0);
    expect(sumDistanceKm(null)).toBe(0);
  });
});

describe('sumEarnings', () => {
  it('totals gross and net separately', () => {
    const { gross, net } = sumEarnings([
      { total_earnings: 12000, net_earnings: 10000 },
      { total_earnings: 9500, net_earnings: 7700 },
    ]);
    expect(gross).toBe(21500);
    expect(net).toBe(17700);
  });

  it('treats null monetary columns as zero rather than producing NaN', () => {
    const { gross, net } = sumEarnings([
      { total_earnings: null, net_earnings: undefined },
      { total_earnings: 5000, net_earnings: 4000 },
    ]);
    expect(gross).toBe(5000);
    expect(net).toBe(4000);
  });

  it('returns zeros for empty or non-array input', () => {
    expect(sumEarnings([])).toEqual({ gross: 0, net: 0 });
    expect(sumEarnings(undefined)).toEqual({ gross: 0, net: 0 });
  });
});

describe('buildWeeklyChart', () => {
  it('always returns seven day buckets for the week period', () => {
    expect(buildWeeklyChart([], { period: 'week', now: BASE })).toHaveLength(7);
  });

  it('returns one bucket for the day period and thirty for the month period', () => {
    expect(buildWeeklyChart([], { period: 'day', now: BASE })).toHaveLength(1);
    expect(buildWeeklyChart([], { period: 'month', now: BASE })).toHaveLength(30);
  });

  it('buckets earnings onto the correct calendar date', () => {
    const chart = buildWeeklyChart(
      [{ trip_date: daysFrom(BASE, 0), total_earnings: 5000 }],
      { period: 'week', now: BASE }
    );
    const bucketsWithEarnings = chart.filter((b) => b.earnings > 0);
    expect(bucketsWithEarnings).toHaveLength(1);
    expect(bucketsWithEarnings[0].day).toBe(daysFrom(BASE, 0));
  });

  it('accumulates multiple trips on the same day', () => {
    const chart = buildWeeklyChart(
      [
        { trip_date: daysFrom(BASE, 0), total_earnings: 5000 },
        { trip_date: daysFrom(BASE, 0), total_earnings: 3000 },
      ],
      { period: 'week', now: BASE }
    );
    expect(chart.reduce((s, b) => s + b.earnings, 0)).toBe(8000);
  });

  it('does not merge the same weekday across different weeks', () => {
    // 2026-07-12 and 2026-08-02 are exactly 21 days apart, so they share a
    // weekday. They must land in distinct date buckets.
    const chart = buildWeeklyChart(
      [
        { trip_date: '2026-07-12', total_earnings: 1000 },
        { trip_date: '2026-08-02', total_earnings: 2000 },
      ],
      { period: 'month', now: new Date('2026-08-10T00:00:00.000Z') }
    );
    const bucketsWithEarnings = chart.filter((b) => b.earnings > 0);
    expect(bucketsWithEarnings).toHaveLength(2);
    expect(bucketsWithEarnings[0].day).toBe('2026-07-12');
    expect(bucketsWithEarnings[1].day).toBe('2026-08-02');
  });

  it('ignores trips with an unparseable date', () => {
    const chart = buildWeeklyChart(
      [{ trip_date: 'not-a-date', total_earnings: 5000 }],
      { period: 'week', now: BASE }
    );
    expect(chart.reduce((s, b) => s + b.earnings, 0)).toBe(0);
  });

  it('treats a null total_earnings as zero', () => {
    const chart = buildWeeklyChart(
      [{ trip_date: daysFrom(BASE, 0), total_earnings: null }],
      { period: 'week', now: BASE }
    );
    expect(chart.every((b) => Number.isFinite(b.earnings))).toBe(true);
  });

  it('handles empty and non-array input', () => {
    expect(buildWeeklyChart(null, { period: 'week', now: BASE })).toHaveLength(7);
    expect(buildWeeklyChart(undefined, { period: 'week', now: BASE })).toHaveLength(7);
  });
});

describe('countDeadheadTripsSaved', () => {
  it('counts a trip that starts where the previous one ended', () => {
    const trips = [
      { route_label: 'Surat → Jaipur', trip_date: daysFrom(BASE, 0) },
      { route_label: 'Jaipur → Pune', trip_date: daysFrom(BASE, 1) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(1);
  });

  it('counts a pair at exactly the gap boundary', () => {
    const trips = [
      { route_label: 'Surat → Jaipur', trip_date: daysFrom(BASE, 0) },
      { route_label: 'Jaipur → Pune', trip_date: daysFrom(BASE, DEADHEAD_MAX_GAP_DAYS) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(1);
  });

  it('does not count a pair beyond the gap boundary', () => {
    const trips = [
      { route_label: 'Surat → Jaipur', trip_date: daysFrom(BASE, 0) },
      { route_label: 'Jaipur → Pune', trip_date: daysFrom(BASE, DEADHEAD_MAX_GAP_DAYS + 1) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(0);
  });

  it('does not count when the drop and next pickup differ', () => {
    const trips = [
      { route_label: 'Surat → Jaipur', trip_date: daysFrom(BASE, 0) },
      { route_label: 'Pune → Nagpur', trip_date: daysFrom(BASE, 1) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(0);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const trips = [
      { route_label: 'Surat →  JAIPUR ', trip_date: daysFrom(BASE, 0) },
      { route_label: ' jaipur  → Pune', trip_date: daysFrom(BASE, 1) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(1);
  });

  it('skips malformed route labels without a separator', () => {
    const trips = [
      { route_label: 'Surat to Jaipur', trip_date: daysFrom(BASE, 0) },
      { route_label: 'Jaipur → Pune', trip_date: daysFrom(BASE, 1) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(0);
  });

  it('skips null and empty route labels', () => {
    const trips = [
      { route_label: null, trip_date: daysFrom(BASE, 0) },
      { route_label: '', trip_date: daysFrom(BASE, 1) },
      { route_label: 'Pune → Nagpur', trip_date: daysFrom(BASE, 2) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(0);
  });

  it('skips pairs with an unparseable date', () => {
    const trips = [
      { route_label: 'Surat → Jaipur', trip_date: 'not-a-date' },
      { route_label: 'Jaipur → Pune', trip_date: daysFrom(BASE, 1) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(0);
  });

  it('counts every qualifying pair in a chain', () => {
    const trips = [
      { route_label: 'Surat → Jaipur', trip_date: daysFrom(BASE, 0) },
      { route_label: 'Jaipur → Pune', trip_date: daysFrom(BASE, 1) },
      { route_label: 'Pune → Nagpur', trip_date: daysFrom(BASE, 2) },
    ];
    expect(countDeadheadTripsSaved(trips)).toBe(2);
  });

  it('returns 0 for fewer than two trips', () => {
    expect(countDeadheadTripsSaved([])).toBe(0);
    expect(countDeadheadTripsSaved([{ route_label: 'A → B', trip_date: daysFrom(BASE, 0) }])).toBe(0);
  });

  it('returns 0 for null or non-array input', () => {
    expect(countDeadheadTripsSaved(null)).toBe(0);
    expect(countDeadheadTripsSaved(undefined)).toBe(0);
  });
});

describe('toDateKey', () => {
  it('formats a Date as the YYYY-MM-DD the column stores', () => {
    expect(toDateKey(new Date('2026-08-05T15:30:00.000Z'))).toBe('2026-08-05');
  });
});
