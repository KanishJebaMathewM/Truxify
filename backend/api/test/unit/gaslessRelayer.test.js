import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/lib/redisLock.js', () => ({
  acquireDistributedLock: vi.fn(async () => ({ acquired: true, release: vi.fn(async () => {}) })),
}));

const { ethers } = await import('ethers');
const { acquireDistributedLock } = await import('../../src/lib/redisLock.js');
const { GaslessRelayerService } = await import('../../src/services/blockchain/gaslessRelayerService.js');

const fakeProvider = () => ({
  getFeeData: vi.fn(async () => ({
    maxPriorityFeePerGas: ethers.parseUnits('25', 'gwei'), // below the 30 gwei floor
    gasPrice: ethers.parseUnits('100', 'gwei'),
  })),
  getTransactionCount: vi.fn(async () => 7),
});

describe('GaslessRelayerService.estimateGasFees', () => {
  it('floors the priority fee at 30 gwei (Polygon minimum) and buffers the base fee 20%', async () => {
    const svc = new GaslessRelayerService({ provider: fakeProvider() });
    const fees = await svc.estimateGasFees();
    expect(fees.maxPriorityFeePerGas).toBe(ethers.parseUnits('30', 'gwei'));
    // maxFee = 100 gwei * 1.2 + 30 gwei = 150 gwei
    expect(fees.maxFeePerGas).toBe(ethers.parseUnits('150', 'gwei'));
  });

  it('uses the network priority fee when it exceeds the floor', async () => {
    const p = fakeProvider();
    p.getFeeData = vi.fn(async () => ({
      maxPriorityFeePerGas: ethers.parseUnits('45', 'gwei'),
      gasPrice: ethers.parseUnits('200', 'gwei'),
    }));
    const svc = new GaslessRelayerService({ provider: p });
    const fees = await svc.estimateGasFees();
    expect(fees.maxPriorityFeePerGas).toBe(ethers.parseUnits('45', 'gwei'));
    expect(fees.maxFeePerGas).toBe(ethers.parseUnits('285', 'gwei')); // 240 + 45
  });
});

describe('GaslessRelayerService.relayMilestoneRelease guardrails', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when wallet/contract are unconfigured (no on-chain call)', async () => {
    const svc = new GaslessRelayerService({ provider: fakeProvider() });
    await expect(svc.relayMilestoneRelease({
      bookingId: 'B1', milestoneId: 1, amount: 100n, nonce: 0,
      deadline: Math.floor(Date.now() / 1000) + 600, signature: '0x' + 'ab'.repeat(65),
    })).rejects.toThrow(/not configured/);
  });

  it('throws when the nonce lock is busy (no double-broadcast)', async () => {
    acquireDistributedLock.mockResolvedValueOnce({ acquired: false, release: vi.fn() });
    const svc = new GaslessRelayerService({
      provider: fakeProvider(),
      relayerPrivateKey: '0x' + '59'.repeat(32),
      contractAddress: '0x00000000000000000000000000000000000000A1',
    });
    await expect(svc.relayMilestoneRelease({
      bookingId: 'B1', milestoneId: 1, amount: 100n, nonce: 0,
      deadline: Math.floor(Date.now() / 1000) + 600, signature: '0x' + 'ab'.repeat(65),
    })).rejects.toThrow(/lock is busy/);
  });
});
