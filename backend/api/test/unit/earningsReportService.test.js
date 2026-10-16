import { describe, it, expect } from 'vitest';
import {
  getEarningsCutoff,
  getDeadheadCutoff,
  toDateKey,
  parseDistanceKm,
  buildWeeklyChart,
  EARNINGS_TRIP_COLUMNS,
  DEADHEAD_COLUMNS,
  DEADHEAD_MAX_GAP_DAYS,
  DEADHEAD_MAX_ROWS,
  EARNINGS_MAX_ROWS,
} from '../../src/services/driver/earningsReportService.js';

describe('earningsReportService constants', () => {
  it('EARNINGS_TRIP_COLUMNS is a string', () => {
    expect(typeof EARNINGS_TRIP_COLUMNS).toBe('string');
    expect(EARNINGS_TRIP_COLUMNS).toContain('trip_display_id');
  });

  it('DEADHEAD_COLUMNS equals expected string', () => {
    expect(DEADHEAD_COLUMNS).toBe('route_label, trip_date');
  });

  it('DEADHEAD_MAX_GAP_DAYS is 3', () => {
    expect(DEADHEAD_MAX_GAP_DAYS).toBe(3);
  });

  it('DEADHEAD_MAX_ROWS is 1000', () => {
    expect(DEADHEAD_MAX_ROWS).toBe(1000);
  });

  it('EARNINGS_MAX_ROWS is 1000', () => {
    expect(EARNINGS_MAX_ROWS).toBe(1000);
  });
});

describe('getEarningsCutoff', () => {
  it('returns null for unknown period', () => {
    expect(getEarningsCutoff('year')).toBeNull();
  });

  it('returns null for empty period', () => {
    expect(getEarningsCutoff('')).toBeNull();
  });

  it('returns null for null period', () => {
    expect(getEarningsCutoff(null)).toBeNull();
  });

  it('returns start of today for day period', () => {
    const now = new Date('2025-06-15T14:30:00Z');
    const cutoff = getEarningsCutoff('day', now);
    expect(cutoff.toISOString()).toBe('2025-06-15T00:00:00.000Z');
  });

  it('uses the UTC day for the day period even when the local day differs (IST evening)', () => {
    // 2026-08-05T19:00:00Z is 00:30 IST on Aug 6. The trip_date keys are UTC
    // days, so "today" must start at 2026-08-05T00:00Z — never Aug 4.
    const cutoff = getEarningsCutoff('day', new Date('2026-08-05T19:00:00Z'));
    expect(cutoff.toISOString()).toBe('2026-08-05T00:00:00.000Z');
    expect(toDateKey(cutoff)).toBe('2026-08-05');
  });

  it('returns 7 days ago for week period', () => {
    const now = new Date('2025-06-15T00:00:00Z');
    const cutoff = getEarningsCutoff('week', now);
    expect(cutoff.toISOString()).toBe('2025-06-08T00:00:00.000Z');
  });

  it('returns 30 days ago for month period', () => {
    const now = new Date('2025-06-15T00:00:00Z');
    const cutoff = getEarningsCutoff('month', now);
    expect(cutoff.toISOString()).toBe('2025-05-16T00:00:00.000Z');
  });
});

describe('getDeadheadCutoff', () => {
  it('extends cutoff by DEADHEAD_MAX_GAP_DAYS days', () => {
    const cutoff = new Date('2025-06-15T00:00:00Z');
    const deadhead = getDeadheadCutoff(cutoff);
    expect(deadhead.toISOString()).toBe('2025-06-12T00:00:00.000Z');
  });
});

describe('toDateKey', () => {
  it('formats Date as YYYY-MM-DD', () => {
    const result = toDateKey(new Date('2025-06-15T14:30:00Z'));
    expect(result).toBe('2025-06-15');
  });

  it('handles UTC midnight', () => {
    const result = toDateKey(new Date('2025-01-01T00:00:00.000Z'));
    expect(result).toBe('2025-01-01');
  });
});

describe('parseDistanceKm', () => {
  it('returns 0 for null', () => {
    expect(parseDistanceKm(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(parseDistanceKm(undefined)).toBe(0);
  });

  it('parses plain number', () => {
    expect(parseDistanceKm(420)).toBe(420);
  });

  it('parses string number', () => {
    expect(parseDistanceKm('350')).toBe(350);
  });

  it('parses number with km suffix', () => {
    expect(parseDistanceKm('420 km')).toBe(420);
  });

  it('parses number with km suffix and space', () => {
    expect(parseDistanceKm('350km')).toBe(350);
  });

  it('parses float with km suffix', () => {
    expect(parseDistanceKm('420.5 km')).toBe(420.5);
  });

  it('returns 0 for string with no number', () => {
    expect(parseDistanceKm('no number here')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseDistanceKm('')).toBe(0);
  });

  it('parses number with decimal point', () => {
    expect(parseDistanceKm('123.456km')).toBe(123.456);
  });
});

describe('buildWeeklyChart', () => {
  it('creates correct number of buckets for day period', () => {
    const now = new Date('2025-06-15T00:00:00Z');
    const chart = buildWeeklyChart([], { period: 'day', now });
    expect(chart.length).toBe(1);
  });

  it('creates 7 buckets for week period', () => {
    const now = new Date('2025-06-15T00:00:00Z');
    const chart = buildWeeklyChart([], { period: 'week', now });
    expect(chart.length).toBe(7);
  });

  it('creates 30 buckets for month period', () => {
    const now = new Date('2025-06-15T00:00:00Z');
    const chart = buildWeeklyChart([], { period: 'month', now });
    expect(chart.length).toBe(30);
  });

  it('all buckets have day and earnings fields', () => {
    const now = new Date('2025-06-15T00:00:00Z');
    const chart = buildWeeklyChart([], { period: 'week', now });
    for (const bucket of chart) {
      expect(bucket).toHaveProperty('day');
      expect(bucket).toHaveProperty('earnings');
    }
  });

});
