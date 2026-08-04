import { describe, it, expect, beforeEach } from 'vitest';
import AnomalyDetectionService from './anomalyDetectionService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal transaction with the given UTC hour baked in. */
function txAtUtcHour(utcHour) {
  // Fix the date to 2026-01-15; only the hour matters for detectUnusualTime.
  const ts = new Date(Date.UTC(2026, 0, 15, utcHour, 30, 0));
  return { timestamp: ts.toISOString(), amount: '10' };
}

// ---------------------------------------------------------------------------
// Tests for detectUnusualTime (issue #6127)
// ---------------------------------------------------------------------------

describe('AnomalyDetectionService.detectUnusualTime', () => {
  let svc;

  beforeEach(() => {
    svc = new AnomalyDetectionService();
  });

  // UNUSUAL_TIME window is 00:00 UTC (inclusive) – 06:00 UTC (exclusive).

  it('returns null for a transaction at 10:00 UTC (outside window)', () => {
    const result = svc.detectUnusualTime(txAtUtcHour(10));
    expect(result).toBeNull();
  });

  it('returns null for a transaction at 06:00 UTC (boundary — window is exclusive)', () => {
    const result = svc.detectUnusualTime(txAtUtcHour(6));
    expect(result).toBeNull();
  });

  it('flags a transaction at 00:00 UTC (window start)', () => {
    const result = svc.detectUnusualTime(txAtUtcHour(0));
    expect(result).not.toBeNull();
    expect(result.type).toBe('UNUSUAL_TIME');
    expect(result.severity).toBe('LOW');
    expect(result.message).toContain('0:00 UTC');
  });

  it('flags a transaction at 03:00 UTC (mid-window)', () => {
    const result = svc.detectUnusualTime(txAtUtcHour(3));
    expect(result).not.toBeNull();
    expect(result.message).toContain('3:00 UTC');
  });

  it('flags a transaction at 05:00 UTC (last hour in window)', () => {
    const result = svc.detectUnusualTime(txAtUtcHour(5));
    expect(result).not.toBeNull();
    expect(result.message).toContain('5:00 UTC');
  });

  it('returns the ISO timestamp of the transaction in result.time', () => {
    const tx = txAtUtcHour(2);
    const result = svc.detectUnusualTime(tx);
    expect(result.time).toBe(tx.timestamp);
  });

  // -------------------------------------------------------------------------
  // Regression test: the old getHours() bug would fire for the wrong UTC hour
  // on a server with a non-zero UTC offset.  We pin the exact UTC instant from
  // the issue report (18:30 UTC → IST server would read hour 23, inside window)
  // and assert it is NOT flagged.
  // -------------------------------------------------------------------------
  it('regression: 18:30 UTC is NOT flagged (was incorrectly flagged with getHours() on IST servers)', () => {
    const tx = { timestamp: '2026-08-04T18:30:00.000Z', amount: '50' };
    const result = svc.detectUnusualTime(tx);
    expect(result).toBeNull();
  });
});
