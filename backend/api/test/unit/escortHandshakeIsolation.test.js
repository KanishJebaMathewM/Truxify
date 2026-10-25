import { beforeEach, describe, expect, it, vi } from 'vitest';

const { did, logger } = vi.hoisted(() => ({
  did: { getCredentials: vi.fn(), verifyCredential: vi.fn() },
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../../did/did.service.js', () => ({ default: did }));
vi.mock('../../src/middleware/logger.js', () => ({ default: logger }));
vi.mock('../../src/config/db.js', () => ({ createUserClient: vi.fn() }));
import { handshake } from '../../src/controllers/escortWalletController.js';

async function request(escorts) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  await handshake({ body: { escorts } }, res, next);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(next).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0];
}

describe('escort handshake failure isolation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    did.getCredentials.mockImplementation(async address => [
      { id: address, type: 'Cert', validUntil: 2000000000, revoked: false },
    ]);
    did.verifyCredential.mockResolvedValue({ isValid: true });
  });

  for (const failed of ['first', 'middle', 'last']) {
    it(`continues checking the convoy when the ${failed} lookup fails`, async () => {
      did.getCredentials.mockImplementation(async address => {
        if (address === failed) throw new Error('secret provider details');
        return [{ id: address, type: 'Cert', revoked: false }];
      });
      const result = await request(['first', 'middle', 'last']);
      expect(result.handshake).toBe('FAILED');
      expect(result.allCompliant).toBe(false);
      expect(result.convoy.map(item => item.address)).toEqual(['first', 'middle', 'last']);
      expect(result.convoy.map(item => item.compliant)).toEqual(
        ['first', 'middle', 'last'].map(address => address !== failed),
      );
      expect(result.convoy.find(item => item.address === failed)).toEqual({
        address: failed, compliant: false, reason: 'Credential verification unavailable',
      });
      expect(JSON.stringify(result)).not.toContain('secret provider details');
      expect(did.getCredentials).toHaveBeenCalledTimes(3);
    });
  }

  it('fails the escort closed if verification fails after one valid credential', async () => {
    did.getCredentials.mockResolvedValueOnce([
      { id: 'valid', revoked: false }, { id: 'unavailable', revoked: false },
    ]);
    did.verifyCredential.mockImplementation(async id => {
      if (id === 'unavailable') throw new Error('provider unavailable');
      return { isValid: true };
    });
    const result = await request(['broken', 'healthy']);
    expect(result.convoy[0]).toEqual({
      address: 'broken', compliant: false, reason: 'Credential verification unavailable',
    });
    expect(result.convoy[1].compliant).toBe(true);
    expect(result.allCompliant).toBe(false);
  });
});
