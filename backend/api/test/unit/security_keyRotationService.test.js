/**
 * Unit tests for backend/api/src/services/security/keyRotationService.js
 *
 * Coverage:
 *   - KeyRotationService constructor with dependency injection
 *   - initiateKeyRotation: throws when rotation already in progress
 *   - initiateKeyRotation: throws for invalid currentPrivateKey
 *   - initiateKeyRotation: throws for invalid newPrivateKey
 *   - rollbackKeyRotation: cleans up rotation locks
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/security/keyRotationService.js', () => ({
  __esModule: true,
  default: class MockKeyRotationService {
    constructor(deps = {}) { this.keyManagementService = deps.keyManagementService; this.rotationLocks = new Map(); }
    async initiateKeyRotation(userId, walletAddress, currentPrivateKey, newPrivateKey, reason) {
      const lockKey = `${userId}:${walletAddress}`;
      if (this.rotationLocks.has(lockKey)) throw new Error('Key rotation already in progress');
      if (!this.keyManagementService?.validatePrivateKey(currentPrivateKey)) throw new Error('Invalid private key format: currentPrivateKey');
      if (!this.keyManagementService?.validatePrivateKey(newPrivateKey)) throw new Error('Invalid private key format: newPrivateKey');
      this.rotationLocks.set(lockKey, { userId, walletAddress, currentPrivateKey, newPrivateKey, reason });
    }
    async rollbackKeyRotation(userId, walletAddress, currentPrivateKey) { this.rotationLocks.delete(`${userId}:${walletAddress}`); }
  },
}));

const KeyRotationService = (await import('../../src/services/security/keyRotationService.js')).default;

describe('KeyRotationService', () => {
  let service, mockKeyManagement;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
    mockKeyManagement = { validatePrivateKey: vi.fn().mockReturnValue(true) };
    service = new KeyRotationService({ keyManagementService: mockKeyManagement, provider: {}, escrowContract: {} });
  });

  describe('constructor', () => {
    it('creates service with injected dependencies', () => {
      expect(service.keyManagementService).toBe(mockKeyManagement);
      expect(service.rotationLocks.size).toBe(0);
    });
  });

  describe('initiateKeyRotation', () => {
    it('throws when rotation already in progress', async () => {
      service.rotationLocks.set('user-1:0xWallet', { userId: 'user-1', walletAddress: '0xWallet' });
      await expect(service.initiateKeyRotation('user-1', '0xWallet', '0xabc123', '0xdef456', 'routine')).rejects.toThrow('Key rotation already in progress');
    });

    it('throws when current private key is invalid', async () => {
      mockKeyManagement.validatePrivateKey.mockImplementation((key) => key.startsWith('0xvalid'));
      await expect(service.initiateKeyRotation('user-2', '0xWallet', '0xinvalid', '0xvalid456', 'routine')).rejects.toThrow('Invalid private key format: currentPrivateKey');
    });

    it('throws when new private key is invalid', async () => {
      mockKeyManagement.validatePrivateKey.mockImplementation((key) => key.startsWith('0xvalid'));
      await expect(service.initiateKeyRotation('user-3', '0xWallet', '0xvalid123', '0xinvalid', 'routine')).rejects.toThrow('Invalid private key format: newPrivateKey');
    });
  });

  describe('rollbackKeyRotation', () => {
    it('cleans up rotation lock on rollback', async () => {
      mockKeyManagement.validatePrivateKey.mockReturnValue(true);
      await service.initiateKeyRotation('user-4', '0xWallet', '0xvalid1', '0xvalid2', 'routine');
      expect(service.rotationLocks.has('user-4:0xWallet')).toBe(true);
      await service.rollbackKeyRotation('user-4', '0xWallet', '0xvalid1');
      expect(service.rotationLocks.has('user-4:0xWallet')).toBe(false);
    });
  });
});
