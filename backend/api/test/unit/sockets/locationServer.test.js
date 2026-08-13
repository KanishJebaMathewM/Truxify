import { describe, it, expect } from 'vitest';
import { getActiveDriverCount, parseGpsTimestamp } from '../../../src/sockets/locationServer.js';

describe('locationServer Socket', () => {
  it('returns active driver count', () => {
    expect(typeof getActiveDriverCount()).toBe('number');
  });
});

describe('parseGpsTimestamp', () => {
  it('falls back to the current time for missing timestamps', () => {
    for (const bad of [undefined, null, '']) {
      const ts = parseGpsTimestamp(bad);
      expect(Number.isNaN(ts.getTime())).toBe(false);
    }
  });

  it('falls back to the current time for malformed timestamps', () => {
    for (const bad of ['abc', '0', 'not-a-date', '2026-13-99T99:99:99Z']) {
      const ts = parseGpsTimestamp(bad);
      expect(Number.isNaN(ts.getTime())).toBe(false);
    }
  });

  it('preserves valid timestamps', () => {
    const ts = parseGpsTimestamp('2026-01-01T12:00:00.000Z');
    expect(ts.toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });
});
