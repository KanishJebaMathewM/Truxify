
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCheckEscrowHealth } = vi.hoisted(() => ({
  mockCheckEscrowHealth: vi.fn(),
}));

vi.mock('../../../../src/services/escrow.js', () => ({
  checkEscrowHealth: mockCheckEscrowHealth,
}));

vi.mock('../../../../src/core/health/HealthCheck.js', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    executeCheck: vi.fn((name, check, options) => ({
      name,
      run: check,
      options,
    })),
  };
});

import escrowHealth from '../../../../src/core/health/checks/escrowHealth.js';
import { HealthStatus } from '../../../../src/core/health/HealthCheck.js';

describe('Escrow Health Check Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register the escrow health check with correct defaults', () => {
    const healthCheck = escrowHealth();

    expect(healthCheck.name).toBe('escrow');
    expect(healthCheck.options).toEqual({
      critical: false,
    });
    expect(typeof healthCheck.run).toBe('function');
  });

  it('should allow custom options to override defaults', () => {
    const healthCheck = escrowHealth({
      critical: true,
      timeout: 5000,
    });

    expect(healthCheck.options).toEqual({
      critical: true,
      timeout: 5000,
    });
  });

  it('should preserve default options when custom options are provided', () => {
    const healthCheck = escrowHealth({
      timeout: 3000,
    });

    expect(healthCheck.options).toEqual({
      critical: false,
      timeout: 3000,
    });
  });

  it('should map connected escrow services to HEALTHY', async () => {
    mockCheckEscrowHealth.mockResolvedValue({
      status: 'connected',
      chainId: 11155111,
    });

    const result = await escrowHealth().run();

    expect(result).toEqual({
      status: HealthStatus.HEALTHY,
      metadata: {
        chainId: 11155111,
      },
    });
  });

  it('should map unconfigured escrow services to DEGRADED', async () => {
    mockCheckEscrowHealth.mockResolvedValue({
      status: 'not_configured',
    });

    const result = await escrowHealth().run();

    expect(result).toEqual({
      status: HealthStatus.DEGRADED,
      message: 'not_configured',
    });
  });

  it('should map escrow errors to UNHEALTHY', async () => {
    mockCheckEscrowHealth.mockResolvedValue({
      status: 'error',
      error: 'Connection failed',
    });

    const result = await escrowHealth().run();

    expect(result).toEqual({
      status: HealthStatus.UNHEALTHY,
      message: 'Connection failed',
    });
  });

  it('should use the returned status when no error message exists', async () => {
    mockCheckEscrowHealth.mockResolvedValue({
      status: 'error',
      error: '',
    });

    const result = await escrowHealth().run();

    expect(result).toEqual({
      status: HealthStatus.UNHEALTHY,
      message: 'error',
    });
  });

  it('should handle unknown service statuses as UNHEALTHY', async () => {
    mockCheckEscrowHealth.mockResolvedValue({
      status: 'unknown',
    });

    const result = await escrowHealth().run();

    expect(result).toEqual({
      status: HealthStatus.UNHEALTHY,
      message: 'unknown',
    });
  });

  it('should execute the underlying escrow health check exactly once', async () => {
    mockCheckEscrowHealth.mockResolvedValue({
      status: 'connected',
      chainId: 1,
    });

    await escrowHealth().run();

    expect(mockCheckEscrowHealth).toHaveBeenCalledOnce();
  });

  it('should correctly handle 10,000 generated health scenarios', async () => {
    const totalCases = 10000;

    for (let i = 0; i < totalCases; i++) {
      let input;
      let expected;

      switch (i % 5) {
        case 0:
          input = {
            status: 'connected',
            chainId: i + 1,
          };

          expected = {
            status: HealthStatus.HEALTHY,
            metadata: {
              chainId: i + 1,
            },
          };
          break;

        case 1:
          input = {
            status: 'not_configured',
          };

          expected = {
            status: HealthStatus.DEGRADED,
            message: 'not_configured',
          };
          break;

        case 2:
          input = {
            status: 'error',
            error: `Connection error ${i}`,
          };

          expected = {
            status: HealthStatus.UNHEALTHY,
            message: `Connection error ${i}`,
          };
          break;

        case 3:
          input = {
            status: 'unknown',
          };

          expected = {
            status: HealthStatus.UNHEALTHY,
            message: 'unknown',
          };
          break;

        default:
          input = {
            status: 'error',
            error: '',
          };

          expected = {
            status: HealthStatus.UNHEALTHY,
            message: 'error',
          };
          break;
      }

      mockCheckEscrowHealth.mockResolvedValueOnce(input);

      const result = await escrowHealth().run();

      expect(result).toEqual(expected);
    }

    expect(mockCheckEscrowHealth).toHaveBeenCalledTimes(totalCases);
  });
});
