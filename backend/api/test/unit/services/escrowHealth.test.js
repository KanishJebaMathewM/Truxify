// backend/api/test/unit/services/escrowHealth.test.js

import { describe, it, expect } from 'vitest';
import { evaluateEscrowHealth, EscrowHealthStatus } from '../../../src/services/escrowHealth.js';

describe('escrowHealth Status Mapping Unit Tests (#9666)', () => {

  it('correctly maps active and recently locked escrows to HEALTHY status', () => {
    const escrow = {
      id: 'esc_001',
      status: 'LOCKED',
      lockedAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
      disputeFlag: false,
    };

    const health = evaluateEscrowHealth(escrow);

    expect(health.status).toBe(EscrowHealthStatus.HEALTHY);
    expect(health.flags).toHaveLength(0);
  });

  it('flags stale or long-running locked escrows as WARNING', () => {
    const escrow = {
      id: 'esc_002',
      status: 'LOCKED',
      lockedAt: new Date(Date.now() - 1000 * 60 * 60 * 48), // 48 hours ago (> threshold)
      disputeFlag: false,
    };

    const health = evaluateEscrowHealth(escrow);

    expect(health.status).toBe(EscrowHealthStatus.WARNING);
    expect(health.message).toContain('stale');
  });

  it('escalates disputed or failed escrows to CRITICAL status', () => {
    const escrow = {
      id: 'esc_003',
      status: 'DISPUTED',
      lockedAt: new Date(Date.now() - 1000 * 60 * 60),
      disputeFlag: true,
    };

    const health = evaluateEscrowHealth(escrow);

    expect(health.status).toBe(EscrowHealthStatus.CRITICAL);
    expect(health.flags).toContain('DISPUTE_ACTIVE');
  });

  it('handles malformed or missing escrow objects gracefully', () => {
    expect(() => evaluateEscrowHealth(null)).not.toThrow();
    
    const health = evaluateEscrowHealth({});
    expect(health.status).toBe(EscrowHealthStatus.UNKNOWN);
  });
});
