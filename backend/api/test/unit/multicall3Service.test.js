import { describe, it, expect, vi, beforeEach } from 'vitest';
import Multicall3Service from '../../src/services/blockchain/multicall3Service.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

const CALL_A = { target: '0x1111111111111111111111111111111111111111', callData: '0xabcdef' };
const CALL_B = { target: '0x2222222222222222222222222222222222222222', callData: '0x123456' };

describe('Multicall3Service.batchCallsWithCache', () => {
  let service;

  beforeEach(() => {
    service = new Multicall3Service({});
    service.batchCalls = vi.fn();
  });

  it('marks fresh reads as cached:false', async () => {
    service.batchCalls.mockResolvedValue([
      { success: true, returnData: '0x01', callIndex: 0, blockNumber: 10 },
    ]);

    const results = await service.batchCallsWithCache([CALL_A]);

    expect(results).toHaveLength(1);
    expect(results[0].cached).toBe(false);
    expect(service.batchCalls).toHaveBeenCalledTimes(1);
  });

  it('marks cache hits as cached:true with a cachedAt timestamp', async () => {
    service.batchCalls.mockResolvedValue([
      { success: true, returnData: '0x01', callIndex: 0, blockNumber: 10 },
    ]);

    const first = await service.batchCallsWithCache([CALL_A]);
    expect(first[0].cached).toBe(false);

    const second = await service.batchCallsWithCache([CALL_A]);

    expect(second).toHaveLength(1);
    expect(second[0].cached).toBe(true);
    expect(second[0].cachedAt).toBeTypeOf('number');
    expect(second[0].returnData).toBe('0x01');
    expect(service.batchCalls).toHaveBeenCalledTimes(1);
  });

  it('mixes fresh and cached results in the correct order', async () => {
    service.batchCalls.mockResolvedValue([
      { success: true, returnData: '0xaa', callIndex: 0, blockNumber: 10 },
      { success: true, returnData: '0xbb', callIndex: 1, blockNumber: 10 },
    ]);

    await service.batchCallsWithCache([CALL_A, CALL_B]);

    const results = await service.batchCallsWithCache([CALL_A, CALL_B]);

    expect(results).toHaveLength(2);
    expect(results[0].cached).toBe(true);
    expect(results[1].cached).toBe(true);
    expect(service.batchCalls).toHaveBeenCalledTimes(1);
  });
});
