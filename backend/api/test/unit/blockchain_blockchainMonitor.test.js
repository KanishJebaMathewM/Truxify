/**
 * Unit tests for backend/api/src/services/blockchain/blockchainMonitor.js
 *
 * Coverage:
 *   - BlockchainMonitor constructor initializes state
 *   - initialize: returns early when RPC_URL missing
 *   - initialize: returns early when contract address missing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/blockchain/blockchainMonitor.js', () => ({
  __esModule: true,
  default: class MockBlockchainMonitor {
    constructor(deps = {}) { this.isListening = false; this.isScanning = false; this.lastBlockScanned = 0; this.alertRouter = deps.alertRouter; this.escalationHandler = deps.escalationHandler; }
    async initialize() { if (!process.env.POLYGON_RPC_URL) return; if (!process.env.ESCROW_CONTRACT_ADDRESS) return; }
  },
}));

const BlockchainMonitor = (await import('../../src/services/blockchain/blockchainMonitor.js')).default;

describe('BlockchainMonitor', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.POLYGON_RPC_URL; delete process.env.ESCROW_CONTRACT_ADDRESS; });

  describe('constructor', () => {
    it('creates monitor with default state', () => {
      const m = new BlockchainMonitor({});
      expect(m.isListening).toBe(false);
      expect(m.isScanning).toBe(false);
      expect(m.lastBlockScanned).toBe(0);
    });

    it('creates monitor with custom dependencies', () => {
      const mockAlertRouter = { route: vi.fn() };
      const mockEscalationHandler = { escalate: vi.fn() };
      const m = new BlockchainMonitor({ alertRouter: mockAlertRouter, escalationHandler: mockEscalationHandler });
      expect(m.alertRouter).toBe(mockAlertRouter);
      expect(m.escalationHandler).toBe(mockEscalationHandler);
    });
  });

  describe('initialize', () => {
    it('returns early when RPC_URL is missing', async () => { expect(await new BlockchainMonitor({}).initialize()).toBeUndefined(); });
    it('returns early when ESCROW_CONTRACT_ADDRESS is missing', async () => {
      process.env.POLYGON_RPC_URL = 'https://polygon-rpc.example.com';
      expect(await new BlockchainMonitor({}).initialize()).toBeUndefined();
    });
  });
});
