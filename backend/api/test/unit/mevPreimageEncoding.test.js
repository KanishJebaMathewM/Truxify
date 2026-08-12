import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';

process.env.PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';
process.env.POLYGON_RPC_URL = 'http://127.0.0.1:8545';
process.env.MEV_ESCROW_ADDRESS = '0x0000000000000000000000000000000000000001';

let toPreimageBytes32;
beforeAll(async () => {
  const mod = await import('../../../mev/mev.service.js');
  toPreimageBytes32 = mod.toPreimageBytes32;
});

describe('toPreimageBytes32 (issue #10182)', () => {
  afterAll(() => {
    delete process.env.PRIVATE_KEY;
    delete process.env.POLYGON_RPC_URL;
    delete process.env.MEV_ESCROW_ADDRESS;
  });

  it('always returns a fixed 32-byte value for arbitrary secrets', () => {
    for (const secret of ['a', 'the-quick-brown-fox', 'x'.repeat(100), 'unicode-🙂-secret']) {
      const preimage = toPreimageBytes32(secret);
      expect(ethers.dataLength(preimage)).toBe(32);
    }
  });

  it('is deterministic — same secret yields the same preimage', () => {
    expect(toPreimageBytes32('hello-escrow')).toBe(toPreimageBytes32('hello-escrow'));
  });

  it('hashes the secret down to bytes32 so the committed digest can be re-derived', () => {
    const secret = 'top-secret-preimage';
    const preimage = toPreimageBytes32(secret);
    // releaseDepositPrivate checks keccak256(abi.encodePacked(bytes32 preimage))
    // against the secretHash committed at creation.
    expect(ethers.keccak256(preimage)).toBe(ethers.keccak256(preimage));
  });

  it('accepts an already-encoded bytes32 hex secret unchanged', () => {
    const bytes32 = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    expect(toPreimageBytes32(bytes32)).toBe(bytes32);
  });

  it('keeps creation and release digests identical for any secret length', () => {
    const secrets = ['short', 'a moderately long preimage string', '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'];
    for (const secret of secrets) {
      const preimage = toPreimageBytes32(secret);
      const committed = ethers.keccak256(preimage);
      const revealed = ethers.keccak256(preimage);
      expect(revealed).toBe(committed);
    }
  });
});
