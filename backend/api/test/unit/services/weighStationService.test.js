/**
 * Unit tests for backend/api/src/services/weighStationService.js
 *
 * Coverage:
 *   - checkBypassEligibility returns BYPASS with valid structure
 *   - checkBypassEligibility returns PULL_IN with valid structure
 *   - Result has required fields: action, stationId, reason, timestamp
 *   - timestamp is a valid ISO 8601 string
 *
 * Run with: npx vitest run test/unit/services/weighStationService.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const { checkBypassEligibility } = await import('../../../src/services/weighStationService.js');

describe('checkBypassEligibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

  it('returns an object with action BYPASS when Math.random > 0.2', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const promise = checkBypassEligibility('driver-123', 28.6139, 77.2090);
    vi.advanceTimersByTime(800);
    const result = await promise;

    expect(result.action).toBe('BYPASS');
    expect(result.reason).toBe('Excellent safety score.');
    expect(result.stationId).toMatch(/^WS-\d+$/);
    expect(result.timestamp).toMatch(ISO_REGEX);
  });

  it('returns an object with action PULL_IN when Math.random <= 0.2', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const promise = checkBypassEligibility('driver-456', 19.0760, 72.8777);
    vi.advanceTimersByTime(800);
    const result = await promise;

    expect(result.action).toBe('PULL_IN');
    expect(result.reason).toBe('Random inspection required.');
    expect(result.stationId).toMatch(/^WS-\d+$/);
    expect(result.timestamp).toMatch(ISO_REGEX);
  });

  it('result contains required fields action, stationId, reason, timestamp', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const promise = checkBypassEligibility('driver-789', 25.5, 75.5);
    vi.advanceTimersByTime(800);
    const result = await promise;

    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('stationId');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('timestamp');
  });

  it('timestamp is a valid ISO 8601 string', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const promise = checkBypassEligibility('driver-abc', 12.9716, 77.5946);
    vi.advanceTimersByTime(800);
    const result = await promise;

    expect(result.timestamp).toMatch(ISO_REGEX);
  });

  it('stationId format is WS-{number}', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const promise = checkBypassEligibility('driver-xyz', 30.7320, 76.7748);
    vi.advanceTimersByTime(800);
    const result = await promise;

    expect(result.stationId).toMatch(/^WS-\d+$/);
  });
});
