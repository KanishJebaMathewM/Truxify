import { describe, it, expect } from 'vitest';
import { DomainError } from '../../src/services/order/domainError.js';
import { validateWalletAddress, getWalletDetails } from '../../src/services/wallet/walletService.js';

const VALID_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('walletService', () => {
  it('accepts a valid Ethereum/Polygon address', async () => {
    await expect(validateWalletAddress(VALID_ADDRESS)).resolves.toBe(VALID_ADDRESS);
  });

  it('rejects null, undefined and non-string addresses with a 400 DomainError', async () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      await expect(validateWalletAddress(bad)).rejects.toMatchObject({
        status: 400,
        payload: { error: 'Wallet address is required and must be a valid string.' },
      });
    }
  });

  it('rejects a malformed string address with a 400 DomainError echoing the value', async () => {
    await expect(validateWalletAddress('not-an-address')).rejects.toMatchObject({
      status: 400,
      payload: { error: 'Invalid Ethereum/Polygon wallet address format: "not-an-address".' },
    });
  });

  it('DomainError is a real instance of the shared error class', async () => {
    try {
      await validateWalletAddress(null);
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      return;
    }
    throw new Error('expected validateWalletAddress to throw');
  });

  it('getWalletDetails returns the validated address with sane defaults', async () => {
    const details = await getWalletDetails(VALID_ADDRESS);
    expect(details).toEqual({
      walletAddress: VALID_ADDRESS,
      isActive: true,
      network: 'polygon',
    });
  });
});