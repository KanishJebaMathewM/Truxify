import { describe, it, expect, vi, beforeEach } from 'vitest';
import StateDivergenceDetector from '../../src/services/blockchain/stateDivergenceDetector.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn((name, fn) => fn()),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: null,
}));

describe('StateDivergenceDetector', () => {
  let detector;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars before each test
    delete process.env.POLYGON_RPC_NODES;
    delete process.env.POLYGON_RPC_URL;
    delete process.env.DIVERGENCE_CHECK_INTERVAL_MS;
    detector = new StateDivergenceDetector();
  });

  describe('analyzeDivergence', () => {
    it('returns divergenceDetected false when no responses', () => {
      const result = detector.analyzeDivergence([]);
      expect(result.divergenceDetected).toBe(false);
      expect(result.reason).toBe('no_responses');
    });

    it('detects divergence when block numbers differ by more than 10', () => {
      const nodeStates = [
        { blockNumber: 1000, blockHash: 'hash1' },
        { blockNumber: 1015, blockHash: 'hash2' },
      ];
      const result = detector.analyzeDivergence(nodeStates);
      expect(result.divergenceDetected).toBe(true);
      expect(result.blockDivergence).toBe(15);
    });

    it('does not detect divergence when block numbers differ by 10 or less', () => {
      const nodeStates = [
        { blockNumber: 1000, blockHash: 'hash1' },
        { blockNumber: 1005, blockHash: 'hash2' },
      ];
      const result = detector.analyzeDivergence(nodeStates);
      expect(result.divergenceDetected).toBe(false);
    });

    it('sets canonicalState to the node with highest block number', () => {
      const nodeStates = [
        { blockNumber: 998, blockHash: 'hash1' },
        { blockNumber: 1015, blockHash: 'hash2' },
        { blockNumber: 1012, blockHash: 'hash3' },
      ];
      const result = detector.analyzeDivergence(nodeStates);
      expect(result.canonicalState.blockNumber).toBe(1015);
    });
  });

  describe('calculateDivergenceSeverity', () => {
    it('returns NONE for 0 divergence', () => {
      expect(detector.calculateDivergenceSeverity(0)).toBe('NONE');
    });

    it('returns LOW for divergence <= 5', () => {
      expect(detector.calculateDivergenceSeverity(3)).toBe('LOW');
      expect(detector.calculateDivergenceSeverity(5)).toBe('LOW');
    });

    it('returns MEDIUM for divergence <= 20', () => {
      expect(detector.calculateDivergenceSeverity(10)).toBe('MEDIUM');
      expect(detector.calculateDivergenceSeverity(20)).toBe('MEDIUM');
    });

    it('returns HIGH for divergence <= 50', () => {
      expect(detector.calculateDivergenceSeverity(25)).toBe('HIGH');
      expect(detector.calculateDivergenceSeverity(50)).toBe('HIGH');
    });

    it('returns CRITICAL for divergence > 50', () => {
      expect(detector.calculateDivergenceSeverity(51)).toBe('CRITICAL');
      expect(detector.calculateDivergenceSeverity(100)).toBe('CRITICAL');
    });
  });

  describe('getDivergenceMetrics', () => {
    it('returns metrics object with expected fields', () => {
      const metrics = detector.getDivergenceMetrics();
      expect(metrics).toHaveProperty('totalDivergences');
      expect(metrics).toHaveProperty('activeDivergences');
      expect(metrics).toHaveProperty('rpcNodeCount');
      expect(typeof metrics.totalDivergences).toBe('number');
      expect(typeof metrics.rpcNodeCount).toBe('number');
    });
  });

  describe('resolveDivergence', () => {
    it('returns success false for unknown divergence id', async () => {
      const result = await detector.resolveDivergence('unknown-id', {});
      expect(result.success).toBe(false);
      expect(result.reason).toBe('divergence_not_found');
    });
  });

  describe('parseRpcNodes', () => {
    it('splits comma-separated RPC nodes', () => {
      process.env.POLYGON_RPC_NODES = 'http://node1,http://node2,http://node3';
      const d = new StateDivergenceDetector();
      expect(d.rpcNodes).toEqual(['http://node1', 'http://node2', 'http://node3']);
    });

    it('ignores empty strings', () => {
      process.env.POLYGON_RPC_NODES = 'http://node1,,http://node2,  ';
      const d = new StateDivergenceDetector();
      expect(d.rpcNodes).toEqual(['http://node1', 'http://node2']);
    });
  });
});
