import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return { from: vi.fn() }; },
}));

import BlockchainMonitor from '../../src/services/blockchain/blockchainMonitor.js';

describe('BlockchainMonitor', () => {
  let monitor;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
    delete process.env.ESCROW_CONTRACT_ADDRESS;
    monitor = new BlockchainMonitor({});
  });

  it('constructs in disabled mode without env config', () => {
    expect(monitor.provider).toBeNull();
    expect(monitor.contract).toBeNull();
  });

  it('wires event handlers for all supported event names', () => {
    monitor.setupEventHandlers();
    const expected = ['PaymentReceived', 'InsuranceClaimApproved', 'InsuranceClaimRejected', 'GeofenceBreach', 'BalanceUpdateFailed', 'SmartContractRevert'];
    for (const name of expected) {
      expect(typeof monitor.eventHandlers[name]).toBe('function');
    }
  });

  it('startListening is a no-op when the contract is not initialized', async () => {
    await expect(monitor.startListening()).resolves.toBeUndefined();
    expect(monitor.isListening).toBe(false);
  });

  it('initialize returns false when env vars are missing', async () => {
    const result = await monitor.initialize();
    expect(result).toBe(false);
  });

  it('processLog ignores unparseable logs without throwing', async () => {
    // With no contract/provider the log cannot be parsed; must not throw.
    await expect(monitor.processLog({})).resolves.toBeUndefined();
  });
});
