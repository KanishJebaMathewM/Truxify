import { describe, it, expect, vi } from 'vitest';
import StateDivergenceDetector, { FINALITY_THRESHOLD } from '../../../../src/services/blockchain/stateDivergenceDetector.js';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('ethers', () => ({
  JsonRpcProvider: class {
    constructor() {}
  },
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: async (_name, fn) => fn(),
}));

// Construct an instance without running the constructor's startMonitoring()
// interval, so the test process can exit cleanly.
function makeDetector(overrides = {}) {
  const detector = Object.create(StateDivergenceDetector.prototype);
  detector.rpcNodes = overrides.rpcNodes ?? ['https://node-1', 'https://node-2'];
  detector.providers = overrides.providers ?? [];
  detector.divergences = new Map();
  detector.stateCache = new Map();
  return detector;
}

describe('StateDivergenceDetector', () => {
  it('exports the finality threshold', () => {
    expect(FINALITY_THRESHOLD).toBe(100);
  });

  describe('parseRpcNodes', () => {
    it('splits comma-separated POLYGON_RPC_NODES and trims', () => {
      const detector = makeDetector();
      detector.rpcNodes = [];
      const original = process.env.POLYGON_RPC_NODES;
      process.env.POLYGON_RPC_NODES = ' https://node-1 , https://node-2 ,';
      expect(detector.parseRpcNodes()).toEqual(['https://node-1', 'https://node-2']);
      if (original === undefined) delete process.env.POLYGON_RPC_NODES;
      else process.env.POLYGON_RPC_NODES = original;
    });

    it('falls back to POLYGON_RPC_URL when POLYGON_RPC_NODES is unset', () => {
      const detector = makeDetector();
      detector.rpcNodes = [];
      const originalNodes = process.env.POLYGON_RPC_NODES;
      const originalUrl = process.env.POLYGON_RPC_URL;
      delete process.env.POLYGON_RPC_NODES;
      process.env.POLYGON_RPC_URL = 'https://fallback-node';
      expect(detector.parseRpcNodes()).toEqual(['https://fallback-node']);
      if (originalNodes === undefined) delete process.env.POLYGON_RPC_NODES;
      else process.env.POLYGON_RPC_NODES = originalNodes;
      if (originalUrl === undefined) delete process.env.POLYGON_RPC_URL;
      else process.env.POLYGON_RPC_URL = originalUrl;
    });
  });

  describe('calculateDivergenceSeverity', () => {
    it('maps block divergence to the expected severity bands', () => {
      const detector = makeDetector();
      expect(detector.calculateDivergenceSeverity(0)).toBe('NONE');
      expect(detector.calculateDivergenceSeverity(3)).toBe('LOW');
      expect(detector.calculateDivergenceSeverity(5)).toBe('LOW');
      expect(detector.calculateDivergenceSeverity(6)).toBe('MEDIUM');
      expect(detector.calculateDivergenceSeverity(20)).toBe('MEDIUM');
      expect(detector.calculateDivergenceSeverity(21)).toBe('HIGH');
      expect(detector.calculateDivergenceSeverity(50)).toBe('HIGH');
      expect(detector.calculateDivergenceSeverity(51)).toBe('CRITICAL');
    });
  });

  describe('analyzeDivergence', () => {
    it('returns no_responses for an empty node-state array', () => {
      const detector = makeDetector();
      expect(detector.analyzeDivergence([])).toEqual({
        divergenceDetected: false,
        reason: 'no_responses',
      });
    });

    it('does not detect divergence within 10 blocks', () => {
      const detector = makeDetector();
      const states = [
        { nodeIndex: 0, blockNumber: 1000 },
        { nodeIndex: 1, blockNumber: 1008 },
      ];
      const result = detector.analyzeDivergence(states);
      expect(result.divergenceDetected).toBe(false);
      expect(result.blockDivergence).toBe(8);
      expect(result.divergenceSeverity).toBe('MEDIUM');
      expect(result.maxBlockNumber).toBe(1008);
      expect(result.minBlockNumber).toBe(1000);
    });

    it('detects divergence beyond 10 blocks with the correct canonical state', () => {
      const detector = makeDetector();
      const states = [
        { nodeIndex: 0, blockNumber: 1000 },
        { nodeIndex: 1, blockNumber: 1025 },
      ];
      const result = detector.analyzeDivergence(states);
      expect(result.divergenceDetected).toBe(true);
      expect(result.blockDivergence).toBe(25);
      expect(result.divergenceSeverity).toBe('HIGH');
      expect(result.canonicalState.blockNumber).toBe(1025);
    });

    it('includes the full nodeStates in the result', () => {
      const detector = makeDetector();
      const states = [
        { nodeIndex: 0, blockNumber: 1000 },
        { nodeIndex: 1, blockNumber: 1012 },
      ];
      const result = detector.analyzeDivergence(states);
      expect(result.nodeStates).toEqual(states);
      expect(result.nodeCount).toBe(2);
    });
  });

  describe('compareStates null guards and comparison', () => {
    it('handles both states null', () => {
      const detector = makeDetector();
      const result = detector.compareStates(null, null);
      expect(result).toEqual({ divergent: false, reason: 'both_null' });
    });

    it('handles null on-chain state with existing off-chain state', () => {
      const detector = makeDetector();
      const offChainState = { blockNumber: 1500, blockHash: '0xabc' };
      const result = detector.compareStates(null, offChainState);
      expect(result.divergent).toBe(true);
      expect(result.reason).toBe('on_chain_state_null');
      expect(result.onChainState).toBeNull();
      expect(result.offChainState).toBe(offChainState);
    });

    it('handles null off-chain state with existing on-chain state', () => {
      const detector = makeDetector();
      const onChainState = { blockNumber: 1500, blockHash: '0xabc' };
      const result = detector.compareStates(onChainState, null);
      expect(result.divergent).toBe(true);
      expect(result.reason).toBe('off_chain_state_null');
      expect(result.onChainState).toBe(onChainState);
      expect(result.offChainState).toBeNull();
    });

    it('detects divergence when block difference exceeds 10', () => {
      const detector = makeDetector();
      const onChainState = { blockNumber: 1520, blockHash: '0xabc' };
      const offChainState = { blockNumber: 1500, blockHash: '0xabc' };
      const result = detector.compareStates(onChainState, offChainState);
      expect(result.divergent).toBe(true);
      expect(result.blockDifference).toBe(20);
      expect(result.hashMatch).toBe(true);
    });

    it('detects divergence when block hashes do not match', () => {
      const detector = makeDetector();
      const onChainState = { blockNumber: 1505, blockHash: '0x111' };
      const offChainState = { blockNumber: 1505, blockHash: '0x222' };
      const result = detector.compareStates(onChainState, offChainState);
      expect(result.divergent).toBe(true);
      expect(result.hashMatch).toBe(false);
    });
  });

  describe('reconcileState null guards and database recording', () => {
    it('handles both old and new states null during reconciliation', async () => {
      const detector = makeDetector();
      const result = await detector.reconcileState(null, null);
      expect(result.status).toBe('failed');
      expect(result.divergenceReason).toBe('both_states_null');
      expect(result.blockNumberDifference).toBeNull();
      expect(result.oldState).toBeNull();
      expect(result.newState).toBeNull();
    });

    it('handles oldState (off-chain) null during reconciliation', async () => {
      const detector = makeDetector();
      const newState = { blockNumber: 2500, blockHash: '0xnew' };
      const result = await detector.reconcileState(null, newState);
      expect(result.status).toBe('in_progress');
      expect(result.divergenceReason).toBe('off_chain_state_null');
      expect(result.blockNumberDifference).toBe(2500);
      expect(result.oldState).toBeNull();
      expect(result.newState).toBe(newState);
    });

    it('handles newState (on-chain) null during reconciliation', async () => {
      const detector = makeDetector();
      const oldState = { blockNumber: 2000, blockHash: '0xold' };
      const result = await detector.reconcileState(oldState, null);
      expect(result.status).toBe('in_progress');
      expect(result.divergenceReason).toBe('on_chain_state_null');
      expect(result.blockNumberDifference).toBe(-2000);
      expect(result.oldState).toBe(oldState);
      expect(result.newState).toBeNull();
    });

    it('calculates block difference when both states are present', async () => {
      const detector = makeDetector();
      const oldState = { blockNumber: 2000 };
      const newState = { blockNumber: 2050 };
      const result = await detector.reconcileState(oldState, newState);
      expect(result.status).toBe('in_progress');
      expect(result.divergenceReason).toBeNull();
      expect(result.blockNumberDifference).toBe(50);
    });
  });

  describe('analyzeDivergence null safety', () => {
    it('handles null nodeStates and filters out null elements safely', () => {
      const detector = makeDetector();
      expect(detector.analyzeDivergence(null)).toEqual({
        divergenceDetected: false,
        reason: 'no_responses',
      });

      const mixedStates = [
        null,
        undefined,
        { nodeIndex: 0, blockNumber: 1000 },
        { nodeIndex: 1, blockNumber: 1005 },
      ];
      const result = detector.analyzeDivergence(mixedStates);
      expect(result.nodeCount).toBe(2);
      expect(result.blockDivergence).toBe(5);
      expect(result.divergenceDetected).toBe(false);
    });
  });

  describe('getDivergenceMetrics', () => {
    it('reports active divergences from the in-memory map', () => {
      const detector = makeDetector();
      detector.divergences.set('div_1', { resolved: false });
      detector.divergences.set('div_2', { resolved: true });
      const metrics = detector.getDivergenceMetrics();
      expect(metrics.totalDivergences).toBe(2);
      expect(metrics.activeDivergences).toBe(1);
      expect(metrics.rpcNodeCount).toBe(2);
    });
  });
});
