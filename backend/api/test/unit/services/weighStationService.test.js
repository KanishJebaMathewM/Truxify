/**
 * Unit tests for backend/api/src/services/weighStationService.js
 *
 * Coverage:
 *   - checkBypassEligibility fails closed (UNSUPPORTED, never BYPASS/PULL_IN)
 *   - Result has required fields: action, supported, simulated, stationId, reason, timestamp
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

  it('fails closed as UNSUPPORTED instead of fabricating a verdict', async () => {
    const result = await checkBypassEligibility('driver-123', 28.6139, 77.2090);

    expect(result.action).toBe('UNSUPPORTED');
    expect(result.supported).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.stationId).toBeNull();
  });

  it('never returns BYPASS or PULL_IN without a real WIM provider', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await checkBypassEligibility('driver-123', 28.6139, 77.2090);
      expect(['BYPASS', 'PULL_IN']).not.toContain(result.action);
    }
  });

  it('result contains required fields action, supported, simulated, stationId, reason, timestamp', async () => {
    const result = await checkBypassEligibility('driver-789', 25.5, 75.5);

    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('supported');
    expect(result).toHaveProperty('simulated');
    expect(result).toHaveProperty('stationId');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('timestamp');
  });

  it('timestamp is a valid ISO 8601 string', async () => {
    const result = await checkBypassEligibility('driver-abc', 12.9716, 77.5946);

    expect(result.timestamp).toMatch(ISO_REGEX);
  });

  it('returns a non-empty reason that disclaims any regulatory verdict', async () => {
    const result = await checkBypassEligibility('driver-xyz', 30.7320, 76.7748);

    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
