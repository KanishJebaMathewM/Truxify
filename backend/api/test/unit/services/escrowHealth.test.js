// backend/api/test/unit/services/health/checks/escrowHealth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkEscrowHealth } from '../../../../../services/escrow.js';
import { HealthStatus, executeCheck } from '../../../../../services/health/HealthCheck.js';
import escrowHealth from '../../../../../services/health/checks/escrowHealth.js';

vi.mock('../../../../../services/escrow.js', () => ({
  checkEscrowHealth: vi.fn(),
}));

vi.mock('../../../../../services/health/HealthCheck.js', () => ({
  HealthStatus: {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
  },
  // Replace the real executeCheck so the test can read the arguments escrowHealth passes in.
  executeCheck: vi.fn((name, check, opts) => ({ name, check, opts })),
}));

describe('escrowHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registration', () => {
    it('registers the check under the name "escrow"', () => {
      escrowHealth();
      expect(executeCheck).toHaveBeenCalledTimes(1);
      expect(executeCheck.mock.calls[0][0]).toBe('escrow');
    });

    it('is non-critical by default', () => {
      escrowHealth();
      expect(executeCheck.mock.calls[0][2]).toEqual({ critical: false });
    });

    it('lets opts override critical and adds extra options', () => {
      escrowHealth({ critical: true, timeoutMs: 500 });
      expect(executeCheck.mock.calls[0][2]).toEqual({
        critical: true,
        timeoutMs: 500,
      });
    });
  });

  describe('check function', () => {
    async function runCheck() {
      const { check } = escrowHealth();
      return check();
    }

    it('returns HEALTHY with chainId when connected', async () => {
      checkEscrowHealth.mockResolvedValue({ status: 'connected', chainId: 8453 });
      expect(await runCheck()).toEqual({
        status: HealthStatus.HEALTHY,
        metadata: { chainId: 8453 },
      });
    });

    it('returns DEGRADED when not configured', async () => {
      checkEscrowHealth.mockResolvedValue({ status: 'not_configured' });
      expect(await runCheck()).toEqual({
        status: HealthStatus.DEGRADED,
        message: 'not_configured',
      });
    });

    it('returns UNHEALTHY with the error message when there is an error', async () => {
      checkEscrowHealth.mockResolvedValue({ status: 'error', error: 'RPC timeout' });
      expect(await runCheck()).toEqual({
        status: HealthStatus.UNHEALTHY,
        message: 'RPC timeout',
      });
    });

    it('falls back to status as the message when there is no error text', async () => {
      checkEscrowHealth.mockResolvedValue({ status: 'disconnected' });
      expect(await runCheck()).toEqual({
        status: HealthStatus.UNHEALTHY,
        message: 'disconnected',
      });
    });
  });
});
