import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import * as Sentry from '@sentry/node';
import Multicall3Service, { MAX_CALLS_PER_BATCH } from '../../../../src/services/blockchain/multicall3Service.js';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn((name, fn) => fn()),
}));

const mockContractInstance = {
  aggregate3: vi.fn(),
  aggregate3Value: vi.fn(),
};

vi.mock('ethers', () => {
  const MockContract = vi.fn(function () {
    return mockContractInstance;
  });
  return {
    ethers: {
      Contract: MockContract,
    },
  };
});

describe('Multicall3Service', () => {
  let mockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = {
      send: vi.fn(),
      getBlockNumber: vi.fn(),
    };
    mockContractInstance.aggregate3.mockReset();
    mockContractInstance.aggregate3Value.mockReset();
    ethers.Contract.mockImplementation(function () {
      return mockContractInstance;
    });
  });

  describe('Initialization & Constructor', () => {
    it('initializes ethers.Contract when provider is provided', () => {
      const service = new Multicall3Service({ provider: mockProvider });
      expect(ethers.Contract).toHaveBeenCalledWith(
        '0xcA11bde05977b3631167028862bE2a173976CA11',
        expect.any(Array),
        mockProvider
      );
      expect(service.multicallContract).toBe(mockContractInstance);
    });

    it('does not initialize contract and warns when provider is not provided', () => {
      const service = new Multicall3Service({});
      expect(service.multicallContract).toBeNull();
      expect(ethers.Contract).not.toHaveBeenCalled();
    });

    it('catches and reports error to Sentry if contract initialization throws', () => {
      const error = new Error('Contract init failure');
      ethers.Contract.mockImplementationOnce(function () {
        throw error;
      });

      const service = new Multicall3Service({ provider: mockProvider });
      expect(service.multicallContract).toBeNull();
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it('sets default cache timeout to 5000ms', () => {
      const service = new Multicall3Service({ provider: mockProvider });
      expect(service.cacheTimeout).toBe(5000);
    });

    it('uses MULTICALL_CACHE_TIMEOUT_MS environment variable when set', () => {
      process.env.MULTICALL_CACHE_TIMEOUT_MS = '8000';
      const service = new Multicall3Service({ provider: mockProvider });
      expect(service.cacheTimeout).toBe(8000);
      delete process.env.MULTICALL_CACHE_TIMEOUT_MS;
    });
  });

  describe('Multicall Batching (batchCalls & executeBatch)', () => {
    it('throws an error if multicallContract is not initialized', async () => {
      const service = new Multicall3Service({});
      await expect(
        service.batchCalls([{ target: '0x123', callData: '0xabc' }])
      ).rejects.toThrow('Multicall3 service not initialized');
    });

    it('returns empty array when calls array is empty', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      const result = await service.batchCalls([]);
      expect(result).toEqual([]);
      expect(mockContractInstance.aggregate3).not.toHaveBeenCalled();
    });

    it('batches calls and formats target, allowFailure, and callData', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue({
        blockNumber: 100n,
        returnData: [
          { success: true, returnData: '0x001' },
          { success: true, returnData: '0x002' },
        ],
      });

      const calls = [
        { target: '0xTarget1', callData: '0xData1', allowFailure: true },
        { target: '0xTarget2', callData: '0xData2', allowFailure: false },
      ];

      const result = await service.batchCalls(calls);

      expect(mockContractInstance.aggregate3).toHaveBeenCalledWith([
        { target: '0xTarget1', allowFailure: true, callData: '0xData1' },
        { target: '0xTarget2', allowFailure: false, callData: '0xData2' },
      ]);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        success: true,
        returnData: '0x001',
        callIndex: 0,
        blockNumber: 100n,
      });
      expect(result[1]).toMatchObject({
        success: true,
        returnData: '0x002',
        callIndex: 1,
        blockNumber: 100n,
      });
    });

    it('defaults allowFailure to true if not specified', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue({
        blockNumber: 100n,
        returnData: [{ success: true, returnData: '0x001' }],
      });

      const calls = [{ target: '0xTarget1', callData: '0xData1' }];
      await service.batchCalls(calls);

      expect(mockContractInstance.aggregate3).toHaveBeenCalledWith([
        { target: '0xTarget1', allowFailure: true, callData: '0xData1' },
      ]);
    });

    it('splits calls exceeding MAX_CALLS_PER_BATCH into chunks', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      const totalCalls = MAX_CALLS_PER_BATCH + 50;

      mockContractInstance.aggregate3
        .mockResolvedValueOnce({
          blockNumber: 101n,
          returnData: Array.from({ length: MAX_CALLS_PER_BATCH }, (_, i) => ({
            success: true,
            returnData: `0xchunk1_${i}`,
          })),
        })
        .mockResolvedValueOnce({
          blockNumber: 102n,
          returnData: Array.from({ length: 50 }, (_, i) => ({
            success: true,
            returnData: `0xchunk2_${i}`,
          })),
        });

      const calls = Array.from({ length: totalCalls }, (_, i) => ({
        target: `0xAddress${i}`,
        callData: `0xCalldata${i}`,
      }));

      const results = await service.batchCalls(calls);

      expect(mockContractInstance.aggregate3).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(totalCalls);
      expect(results[0].returnData).toBe('0xchunk1_0');
      expect(results[MAX_CALLS_PER_BATCH].returnData).toBe('0xchunk2_0');
    });
  });

  describe('Result Parsing and Decoding', () => {
    it('applies custom decodeFn to returnData when provided', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue({
        blockNumber: 200n,
        returnData: [{ success: true, returnData: '0x1234' }],
      });

      const decodeFn = vi.fn((data) => ({ decodedValue: data }));
      const calls = [{ target: '0xTarget', callData: '0xCallData', decodeFn }];

      const results = await service.batchCalls(calls);

      expect(decodeFn).toHaveBeenCalledWith('0x1234');
      expect(results[0].decoded).toEqual({ decodedValue: '0x1234' });
      expect(results[0].returnData).toBe('0x1234');
    });

    it('falls back to raw returnData if decodeFn throws an error', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue({
        blockNumber: 200n,
        returnData: [{ success: true, returnData: '0xbadData' }],
      });

      const decodeFn = vi.fn(() => {
        throw new Error('Decoding error');
      });
      const calls = [{ target: '0xTarget', callData: '0xCallData', decodeFn }];

      const results = await service.batchCalls(calls);

      expect(results[0].decoded).toBe('0xbadData');
      expect(results[0].returnData).toBe('0xbadData');
    });

    it('returns raw returnData as decoded when decodeFn is not provided', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue({
        blockNumber: 200n,
        returnData: [{ success: true, returnData: '0xplainData' }],
      });

      const calls = [{ target: '0xTarget', callData: '0xCallData' }];
      const results = await service.batchCalls(calls);

      expect(results[0].decoded).toBe('0xplainData');
    });
  });

  describe('Partial Failures and Error Handling', () => {
    it('handles partial failures gracefully when some calls fail', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue({
        blockNumber: 300n,
        returnData: [
          { success: true, returnData: '0xSuccessResult' },
          { success: false, returnData: '0x' },
        ],
      });

      const calls = [
        { target: '0xTargetSuccess', callData: '0xCall1' },
        { target: '0xTargetFailure', callData: '0xCall2' },
      ];

      const results = await service.batchCalls(calls);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].returnData).toBe('0xSuccessResult');
      expect(results[1].success).toBe(false);
      expect(results[1].returnData).toBe('0x');
    });

    it('handles contract level RPC rejection by capturing error and marking all calls as failed', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      const rpcError = new Error('RPC Node connection failed');
      mockContractInstance.aggregate3.mockRejectedValue(rpcError);

      const calls = [
        { target: '0xTarget1', callData: '0xCall1' },
        { target: '0xTarget2', callData: '0xCall2' },
      ];

      const results = await service.batchCalls(calls);

      expect(Sentry.captureException).toHaveBeenCalledWith(rpcError);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        success: false,
        error: 'RPC Node connection failed',
        callIndex: 0,
      });
      expect(results[1]).toEqual({
        success: false,
        error: 'RPC Node connection failed',
        callIndex: 1,
      });
    });

    it('handles unexpected null result from contract call', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue(null);

      const calls = [{ target: '0xTarget1', callData: '0xCall1' }];
      const results = await service.batchCalls(calls);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        success: false,
        error: 'null_result',
        callIndex: 0,
      });
    });
  });

  describe('Caching (batchCallsWithCache & cache utilities)', () => {
    it('serves cached results on cache hit and only batches uncached calls', async () => {
      const service = new Multicall3Service({ provider: mockProvider });

      // First call batches and caches
      mockContractInstance.aggregate3.mockResolvedValueOnce({
        blockNumber: 400n,
        returnData: [
          { success: true, returnData: '0xResult1' },
          { success: true, returnData: '0xResult2' },
        ],
      });

      const call1 = { target: '0xTarget1', callData: '0xData1' };
      const call2 = { target: '0xTarget2', callData: '0xData2' };

      const initialResults = await service.batchCallsWithCache([call1, call2]);
      expect(initialResults[0].cached).toBe(false);
      expect(initialResults[1].cached).toBe(false);
      expect(mockContractInstance.aggregate3).toHaveBeenCalledTimes(1);

      // Second call includes one cached and one new call
      mockContractInstance.aggregate3.mockResolvedValueOnce({
        blockNumber: 401n,
        returnData: [{ success: true, returnData: '0xResult3' }],
      });

      const call3 = { target: '0xTarget3', callData: '0xData3' };
      const secondResults = await service.batchCallsWithCache([call1, call3]);

      expect(secondResults).toHaveLength(2);
      expect(secondResults[0].cached).toBe(true);
      expect(secondResults[0].returnData).toBe('0xResult1');
      expect(secondResults[1].cached).toBe(false);
      expect(secondResults[1].returnData).toBe('0xResult3');
      expect(mockContractInstance.aggregate3).toHaveBeenCalledTimes(2);
    });

    it('does not cache failed results', async () => {
      const service = new Multicall3Service({ provider: mockProvider });
      mockContractInstance.aggregate3.mockResolvedValue({
        blockNumber: 402n,
        returnData: [{ success: false, returnData: '0x' }],
      });

      const call = { target: '0xTarget', callData: '0xFailedData' };
      await service.batchCallsWithCache([call]);

      const cacheKey = service.generateCacheKey(call);
      expect(service.isInCache(cacheKey)).toBe(false);
    });

    it('evicts expired cache entries', () => {
      const service = new Multicall3Service({ provider: mockProvider });
      service.cacheTimeout = 100;

      const cacheKey = 'testKey';
      service.callCache.set(cacheKey, {
        value: { success: true },
        timestamp: Date.now() - 200,
      });

      expect(service.isInCache(cacheKey)).toBe(false);
      expect(service.callCache.has(cacheKey)).toBe(false);
    });

    it('evicts the oldest entry when cache exceeds maximum size of 1000', () => {
      const service = new Multicall3Service({ provider: mockProvider });

      for (let i = 0; i < 1000; i++) {
        service.setInCache(`key_${i}`, { data: i });
      }
      expect(service.callCache.size).toBe(1000);
      expect(service.callCache.has('key_0')).toBe(true);

      // Add 1001st entry
      service.setInCache('key_1000', { data: 1000 });
      expect(service.callCache.size).toBe(1000);
      expect(service.callCache.has('key_0')).toBe(false);
      expect(service.callCache.has('key_1000')).toBe(true);
    });

    it('clears cache and provides accurate cache stats', () => {
      const service = new Multicall3Service({ provider: mockProvider });
      service.setInCache('key1', { val: 1 });
      service.setInCache('key2', { val: 2 });

      let stats = service.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(1000);
      expect(stats.utilization).toBe('0.20%');

      service.clearCache();
      stats = service.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.utilization).toBe('0.00%');
    });
  });
});
