import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

process.env.POLYGON_RPC_URL = 'http://localhost:8545';
process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);
process.env.ATOMIC_SWAP_ADDRESS = '0x' + '2'.repeat(40);

const mockContract = vi.hoisted(() => ({
  usedHashLocks: vi.fn(),
  openSwap: vi.fn(),
  claimSwap: vi.fn(),
  refundSwap: vi.fn(),
  swaps: vi.fn(),
}));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(() => ({
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
    select: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: mockSupabase,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AtomicSwapService tokenAddress resolution and tx value calculation', () => {
  let swapService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockContract.usedHashLocks.mockResolvedValue(false);
    mockContract.openSwap.mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ hash: '0x123abc' }),
    });

    const module = await import('../../../atomic-swap/swap.service.js');
    swapService = module.default;
    swapService.swap = mockContract;
  });

  it('createSwap funds native swap with parsed amount when tokenAddress is omitted/null', async () => {
    const counterparty = '0x0000000000000000000000000000000000000001';
    const amount = '1.5';
    const secret = 'test-secret-1';
    const initiator = '0x0000000000000000000000000000000000000002';

    const result = await swapService.createSwap(counterparty, null, amount, secret, initiator);

    expect(result.success).toBe(true);
    expect(mockContract.openSwap).toHaveBeenCalledTimes(1);

    const callArgs = mockContract.openSwap.mock.calls[0];
    const txOverrides = callArgs[4];
    expect(txOverrides.value).toEqual(ethers.parseEther('1.5'));
    expect(txOverrides.gasLimit).toBe(300000);
  });

  it('createSwap funds native swap with parsed amount when tokenAddress is ethers.ZeroAddress', async () => {
    const counterparty = '0x0000000000000000000000000000000000000001';
    const amount = '2.0';
    const secret = 'test-secret-2';
    const initiator = '0x0000000000000000000000000000000000000002';

    const result = await swapService.createSwap(counterparty, ethers.ZeroAddress, amount, secret, initiator);

    expect(result.success).toBe(true);
    expect(mockContract.openSwap).toHaveBeenCalledTimes(1);

    const callArgs = mockContract.openSwap.mock.calls[0];
    const txOverrides = callArgs[4];
    expect(txOverrides.value).toEqual(ethers.parseEther('2.0'));
    expect(txOverrides.gasLimit).toBe(300000);
  });

  it('createSwap funds ERC20 swap with value: 0 when tokenAddress is specified', async () => {
    const counterparty = '0x0000000000000000000000000000000000000001';
    const erc20Token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const amount = '100';
    const secret = 'test-secret-3';
    const initiator = '0x0000000000000000000000000000000000000002';

    const result = await swapService.createSwap(counterparty, erc20Token, amount, secret, initiator);

    expect(result.success).toBe(true);
    expect(mockContract.openSwap).toHaveBeenCalledTimes(1);

    const callArgs = mockContract.openSwap.mock.calls[0];
    const txOverrides = callArgs[4];
    expect(txOverrides.value).toBe(0);
    expect(txOverrides.gasLimit).toBe(300000);
  });

  it('createCrossChainSwap funds native swap with parsed amount when tokenAddress is omitted/null', async () => {
    const destChainId = 1;
    const counterparty = '0x0000000000000000000000000000000000000001';
    const amount = '0.5';
    const secret = 'test-secret-4';
    const initiator = '0x0000000000000000000000000000000000000002';

    const result = await swapService.createCrossChainSwap(destChainId, counterparty, undefined, amount, secret, initiator);

    expect(result.success).toBe(true);
    expect(mockContract.openSwap).toHaveBeenCalledTimes(1);

    const callArgs = mockContract.openSwap.mock.calls[0];
    const txOverrides = callArgs[4];
    expect(txOverrides.value).toEqual(ethers.parseEther('0.5'));
    expect(txOverrides.gasLimit).toBe(350000);
  });

  it('createCrossChainSwap funds ERC20 swap with value: 0 when tokenAddress is specified', async () => {
    const destChainId = 1;
    const counterparty = '0x0000000000000000000000000000000000000001';
    const erc20Token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const amount = '50';
    const secret = 'test-secret-5';
    const initiator = '0x0000000000000000000000000000000000000002';

    const result = await swapService.createCrossChainSwap(destChainId, counterparty, erc20Token, amount, secret, initiator);

    expect(result.success).toBe(true);
    expect(mockContract.openSwap).toHaveBeenCalledTimes(1);

    const callArgs = mockContract.openSwap.mock.calls[0];
    const txOverrides = callArgs[4];
    expect(txOverrides.value).toBe(0);
    expect(txOverrides.gasLimit).toBe(350000);
  });
});
