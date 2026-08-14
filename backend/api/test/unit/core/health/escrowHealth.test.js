import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthStatus } from '../../../../src/core/health/HealthCheck.js';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let mockCheckEscrowHealth = null;

vi.mock('../../../../src/services/escrow.js', () => ({
  get checkEscrowHealth() {
    return mockCheckEscrowHealth;
  },
}));

describe('escrowHealth', () => {
  beforeEach(() => {
    mockCheckEscrowHealth = vi.fn();
  });

  it('returns healthy with chainId metadata when the escrow service is connected', async () => {
    mockCheckEscrowHealth.mockResolvedValue({ status: 'connected', chainId: '137' });
    const { default: check } = await import('../../../../src/core/health/checks/escrowHealth.js');
    const result = await check();
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.chainId).toBe('137');
    expect(result.critical).toBe(false);
  });

  it('returns degraded when the escrow service is not configured', async () => {
    mockCheckEscrowHealth.mockResolvedValue({ status: 'not_configured' });
    const { default: check } = await import('../../../../src/core/health/checks/escrowHealth.js');
    const result = await check();
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe('not_configured');
    expect(result.critical).toBe(false);
  });

  it('returns unhealthy with the error message when the escrow check reports an error', async () => {
    mockCheckEscrowHealth.mockResolvedValue({ status: 'error', error: 'RPC timeout' });
    const { default: check } = await import('../../../../src/core/health/checks/escrowHealth.js');
    const result = await check();
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('RPC timeout');
    expect(result.critical).toBe(false);
  });

  it('returns unhealthy with the raw status when the escrow check returns an unknown status', async () => {
    mockCheckEscrowHealth.mockResolvedValue({ status: 'disconnected' });
    const { default: check } = await import('../../../../src/core/health/checks/escrowHealth.js');
    const result = await check();
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('disconnected');
  });

  it('returns unhealthy when checkEscrowHealth throws', async () => {
    mockCheckEscrowHealth.mockRejectedValue(new Error('connection refused'));
    const { default: check } = await import('../../../../src/core/health/checks/escrowHealth.js');
    const result = await check();
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('connection refused');
    expect(result.critical).toBe(false);
  });

  it('includes responseTime and timestamp fields on a healthy result', async () => {
    mockCheckEscrowHealth.mockResolvedValue({ status: 'connected', chainId: '137' });
    const { default: check } = await import('../../../../src/core/health/checks/escrowHealth.js');
    const result = await check();
    expect(typeof result.responseTime).toBe('number');
    expect(typeof result.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
