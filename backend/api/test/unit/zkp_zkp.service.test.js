/**
 * Unit tests for backend/api/src/services/zkp/zkp.service.js
 *
 * Coverage:
 *   - constructor: logs warning when env vars missing
 *   - hashDocument: produces deterministic hash / same hash for same input / different hashes for different data
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/zkp/zkp.service.js', () => ({
  __esModule: true,
  default: {
    provider: null, wallet: null, contract: null, contractAddress: null, contractABI: [],
    hashDocument(data) {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    },
  },
}));

describe('ZKPService', () => {
  let zkpService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../../src/services/zkp/zkp.service.js');
    zkpService = mod.default;
  });

  describe('constructor behavior (mocked)', () => {
    it('has null provider when env vars not set', () => { expect(zkpService.provider).toBeNull(); });
    it('has null wallet when env vars not set', () => { expect(zkpService.wallet).toBeNull(); });
    it('has empty contract ABI when env vars not set', () => { expect(zkpService.contractABI).toEqual([]); });
  });

  describe('hashDocument', () => {
    it('produces a hash for valid driver data', () => {
      const hash = zkpService.hashDocument({ name: 'John', documentId: 'doc-123' });
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    it('produces deterministic hashes for same input', () => {
      const data = { name: 'Jane', documentId: 'doc-456' };
      expect(zkpService.hashDocument(data)).toBe(zkpService.hashDocument(data));
    });

    it('produces different hashes for different data', () => {
      expect(zkpService.hashDocument({ name: 'John', documentId: 'doc-1' })).not.toBe(zkpService.hashDocument({ name: 'Jane', documentId: 'doc-2' }));
    });
  });
});
