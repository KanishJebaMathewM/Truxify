/**
 * Unit tests for backend/api/src/services/reputation.js
 *
 * Coverage:
 *   - contract initialisation path (null when env vars missing)
 *   - contract initialisation path (creates client when env vars present)
 *   - contract initialisation error handling (remains null on failure)
 *   - awardReputationPoints skips gracefully when contract is null
 *   - awardReputationPoints validates wallet address format and skips
 *   - awardReputationPoints successfully calls increaseReputation on contract
 *   - getDriverReputation returns null when contract is null
 *   - getDriverReputation returns null for invalid wallet address
 *   - getDriverReputation returns score from contract
 *   - getDriverReputation returns null on RPC error
 *
 * Run with:  npm run test:unit -- test/unit/reputation.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// Mock ethers
vi.mock('ethers', async (importOriginal) => {
  const original = await importOriginal();
  
  const mockContractInstance = {
    increaseReputation: vi.fn(),
    getReputation: vi.fn(),
  };

  const mockJsonRpcProvider = vi.fn(function() { return {}; });
  const mockWallet = vi.fn(function() { return {}; });
  const mockContract = vi.fn(function() { return mockContractInstance; });

  const mockedEthers = {
    ...original.ethers,
    JsonRpcProvider: mockJsonRpcProvider,
    Wallet: mockWallet,
    Contract: mockContract,
    _mocks: {
      mockContractInstance,
      mockJsonRpcProvider,
      mockWallet,
      mockContract,
    },
  };
  return {
    ...original,
    ethers: mockedEthers,
  };
});

// Import ethers to extract our mocks
import { ethers } from 'ethers';
const {
  mockContractInstance,
  mockJsonRpcProvider,
  mockWallet,
  mockContract,
} = ethers._mocks;

// Import service components statically (live bindings for reputationContract)
import {
  awardReputationPoints,
  getDriverReputation,
  reputationContract,
  initReputationContract,
} from '../../src/services/reputation.js';

describe('reputation service', () => {
  const originalEnv = {};
  const ENV_VARS = ['POLYGON_RPC_URL', 'REPUTATION_CONTRACT_ADDRESS', 'RELAYER_WALLET_PRIVATE_KEY'];

  beforeEach(() => {
    ENV_VARS.forEach((k) => {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    });
    mockContractInstance.increaseReputation.mockReset();
    mockContractInstance.getReputation.mockReset();
    mockJsonRpcProvider.mockClear();
    mockWallet.mockClear();
    mockContract.mockClear();

    // Reset default mock implementations using proper functions (not arrow functions)
    mockJsonRpcProvider.mockImplementation(function() { return {}; });
    mockWallet.mockImplementation(function() { return {}; });
    mockContract.mockImplementation(function() { return mockContractInstance; });
  });

  afterEach(() => {
    ENV_VARS.forEach((k) => {
      if (originalEnv[k] !== undefined) {
        process.env[k] = originalEnv[k];
      } else {
        delete process.env[k];
      }
    });
    vi.restoreAllMocks();
  });

  describe('initialisation', () => {
    it('is null when environment variables are missing', () => {
      initReputationContract();
      expect(reputationContract).toBeNull();
    });

    it('initialises the contract when environment variables are present', () => {
      process.env.POLYGON_RPC_URL = 'http://localhost:8545';
      process.env.REPUTATION_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RELAYER_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      initReputationContract();

      expect(reputationContract).not.toBeNull();
      expect(mockJsonRpcProvider).toHaveBeenCalledWith('http://localhost:8545');
      expect(mockWallet).toHaveBeenCalledWith(
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        expect.any(Object)
      );
      expect(mockContract).toHaveBeenCalledWith(
        '0x1234567890123456789012345678901234567890',
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('sets reputationContract to null and logs error if initialisation throws', () => {
      process.env.POLYGON_RPC_URL = 'http://localhost:8545';
      process.env.REPUTATION_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RELAYER_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      mockJsonRpcProvider.mockImplementationOnce(function() {
        throw new Error('Invalid RPC provider URL');
      });

      initReputationContract();
      expect(reputationContract).toBeNull();
    });
  });

  describe('awardReputationPoints', () => {
    it('skips gracefully when reputationContract is null', async () => {
      initReputationContract();
      await awardReputationPoints('0x1234567890123456789012345678901234567890', 5);
      expect(mockContractInstance.increaseReputation).not.toHaveBeenCalled();
    });

    it('skips and does not call contract for invalid wallet address when contract is initialised', async () => {
      process.env.POLYGON_RPC_URL = 'http://localhost:8545';
      process.env.REPUTATION_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RELAYER_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      initReputationContract();

      await awardReputationPoints('not-an-address', 5);
      await awardReputationPoints('', 5);
      expect(mockContractInstance.increaseReputation).not.toHaveBeenCalled();
    });

    it('successfully calls increaseReputation on the contract', async () => {
      process.env.POLYGON_RPC_URL = 'http://localhost:8545';
      process.env.REPUTATION_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RELAYER_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      initReputationContract();

      const mockTx = {
        hash: '0xhash123',
        wait: vi.fn().mockResolvedValue({ status: 1 }),
      };
      mockContractInstance.increaseReputation.mockResolvedValue(mockTx);

      const driverAddress = '0x1234567890123456789012345678901234567890';
      await awardReputationPoints(driverAddress, 5);

      expect(mockContractInstance.increaseReputation).toHaveBeenCalledWith(driverAddress, 5);
      expect(mockTx.wait).toHaveBeenCalledWith(1);
    });
  });

  describe('getDriverReputation', () => {
    it('returns null when reputationContract is null', async () => {
      initReputationContract();
      const result = await getDriverReputation('0x1234567890123456789012345678901234567890');
      expect(result).toBeNull();
      expect(mockContractInstance.getReputation).not.toHaveBeenCalled();
    });

    it('returns null and does not call contract for invalid wallet address when contract is initialised', async () => {
      process.env.POLYGON_RPC_URL = 'http://localhost:8545';
      process.env.REPUTATION_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RELAYER_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      initReputationContract();

      const result = await getDriverReputation('invalid-address');
      expect(result).toBeNull();
      expect(mockContractInstance.getReputation).not.toHaveBeenCalled();
    });

    it('returns the score from the contract', async () => {
      process.env.POLYGON_RPC_URL = 'http://localhost:8545';
      process.env.REPUTATION_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RELAYER_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      initReputationContract();

      mockContractInstance.getReputation.mockResolvedValue(42n);

      const driverAddress = '0x1234567890123456789012345678901234567890';
      const result = await getDriverReputation(driverAddress);

      expect(result).toBe(42);
      expect(mockContractInstance.getReputation).toHaveBeenCalledWith(driverAddress);
    });

    it('returns null on RPC error', async () => {
      process.env.POLYGON_RPC_URL = 'http://localhost:8545';
      process.env.REPUTATION_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RELAYER_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      initReputationContract();

      mockContractInstance.getReputation.mockRejectedValue(new Error('RPC Error: Network unreachable'));

      const driverAddress = '0x1234567890123456789012345678901234567890';
      const result = await getDriverReputation(driverAddress);

      expect(result).toBeNull();
      expect(mockContractInstance.getReputation).toHaveBeenCalledWith(driverAddress);
    });
  });
});
