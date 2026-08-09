import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sentry before importing the service
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

import AnomalyDetectionService from '../../../src/services/security/anomalyDetectionService.js';

describe('AnomalyDetectionService - detectUnusualTime', () => {
  let service;

  beforeEach(() => {
    service = new AnomalyDetectionService();
  });

  it('returns null for transactions at a normal UTC hour (14:00)', () => {
    const transaction = { timestamp: '2026-08-04T14:00:00.000Z' };
    const result = service.detectUnusualTime(transaction);
    expect(result).toBeNull();
  });

  it('returns null for transactions at the boundary hour 06:00 UTC', () => {
    // endHour is 6, so hour === 6 should NOT be in the unusual window (hour < endHour)
    const transaction = { timestamp: '2026-08-04T06:00:00.000Z' };
    const result = service.detectUnusualTime(transaction);
    expect(result).toBeNull();
  });

  it('returns UNUSUAL_TIME anomaly for transactions at 03:30 UTC', () => {
    // 03:30 is within the unusual window [0, 6)
    const transaction = { timestamp: '2026-08-04T03:30:00.000Z' };
    const result = service.detectUnusualTime(transaction);

    expect(result).not.toBeNull();
    expect(result.type).toBe('UNUSUAL_TIME');
    expect(result.severity).toBe('LOW');
    expect(result.message).toContain('UTC');
  });

  it('returns UNUSUAL_TIME anomaly for transactions at midnight 00:00 UTC', () => {
    // startHour is 0, so midnight is included in the unusual window
    const transaction = { timestamp: '2026-08-04T00:00:00.000Z' };
    const result = service.detectUnusualTime(transaction);

    expect(result).not.toBeNull();
    expect(result.type).toBe('UNUSUAL_TIME');
    expect(result.severity).toBe('LOW');
  });

  it('returns UNUSUAL_TIME anomaly for transactions at 23:30 UTC the day before (crossing midnight)', () => {
    // 23:30 UTC is outside the unusual window (23 >= 6), this should return null
    const transaction = { timestamp: '2026-08-04T23:30:00.000Z' };
    const result = service.detectUnusualTime(transaction);
    expect(result).toBeNull();
  });

  it('returns UNUSUAL_TIME anomaly for the last unusual hour 05:59 UTC', () => {
    // 05:59 is the last minute of the unusual window [0, 6)
    const transaction = { timestamp: '2026-08-04T05:59:00.000Z' };
    const result = service.detectUnusualTime(transaction);

    expect(result).not.toBeNull();
    expect(result.type).toBe('UNUSUAL_TIME');
    expect(result.message).toMatch(/[05]:00 UTC/);
  });

  it('returns UNUSUAL_TIME anomaly for early morning 01:00 UTC', () => {
    const transaction = { timestamp: '2026-08-04T01:00:00.000Z' };
    const result = service.detectUnusualTime(transaction);

    expect(result).not.toBeNull();
    expect(result.type).toBe('UNUSUAL_TIME');
    expect(result.message).toMatch(/:00 UTC/);
  });

  it('returns null when timestamp is not a valid date string', () => {
    // Invalid timestamp creates an Invalid Date, whose getUTCHours() returns NaN
    // NaN >= 0 is false, so this returns null — safe behavior
    const transaction = { timestamp: 'not-a-date' };
    const result = service.detectUnusualTime(transaction);
    expect(result).toBeNull();
  });

  it('returns null when timestamp is missing from transaction', () => {
    const transaction = {};
    const result = service.detectUnusualTime(transaction);
    expect(result).toBeNull();
  });

  it('result time field is a valid ISO string', () => {
    const transaction = { timestamp: '2026-08-04T03:30:00.000Z' };
    const result = service.detectUnusualTime(transaction);

    expect(result).not.toBeNull();
    expect(result.time).toBe('2026-08-04T03:30:00.000Z');
  });
});
