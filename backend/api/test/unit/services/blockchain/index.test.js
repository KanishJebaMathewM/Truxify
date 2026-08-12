import { describe, it, expect, vi } from 'vitest';
import {
  Multicall3Service,
  BatchCallBuilder,
  BlockchainMonitor,
  AlertRouter,
  SEVERITY_LEVELS,
  ALERT_CHANNELS,
  EscalationHandler,
  ESCALATION_LEVELS,
  ESCALATION_THRESHOLDS,
  BlockchainMetrics,
} from '../../../../src/services/blockchain/index.js';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('ethers', () => ({
  JsonRpcProvider: class {},
  Contract: class {},
  Wallet: class {},
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabase: null,
  redisClient: null,
}));

describe('services/blockchain barrel exports', () => {
  it('exports the service classes', () => {
    expect(typeof Multicall3Service).toBe('function');
    expect(typeof BatchCallBuilder).toBe('function');
    expect(typeof BlockchainMonitor).toBe('function');
    expect(typeof AlertRouter).toBe('function');
    expect(typeof EscalationHandler).toBe('function');
    expect(typeof BlockchainMetrics).toBe('function');
  });

  it('exports the severity and channel constants', () => {
    expect(SEVERITY_LEVELS).toBeDefined();
    expect(Object.keys(SEVERITY_LEVELS).length).toBeGreaterThan(0);
    expect(ALERT_CHANNELS).toBeDefined();
    expect(Object.keys(ALERT_CHANNELS).length).toBeGreaterThan(0);
  });

  it('exports the escalation constants', () => {
    expect(ESCALATION_LEVELS).toBeDefined();
    expect(Object.keys(ESCALATION_LEVELS).length).toBeGreaterThan(0);
    expect(ESCALATION_THRESHOLDS).toBeDefined();
    expect(typeof ESCALATION_THRESHOLDS).toBe('object');
  });
});
