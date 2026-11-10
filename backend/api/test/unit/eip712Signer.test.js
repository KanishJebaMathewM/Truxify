import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ethers } = await import('ethers');
const { Eip712Signer, EIP712_ESCROW_TYPES } = await import('../../src/services/blockchain/eip712Signer.js');

describe('Eip712Signer', () => {
  const signer = new Eip712Signer({ verifyingContract: '0x00000000000000000000000000000000000000A1', chainId: 80002 });

  it('domain pins the escrow contract name/version/chain/contract', () => {
    const d = signer.getDomain();
    expect(d.name).toBe('TruxifyFreightEscrow');
    expect(d.version).toBe('1');
    expect(d.chainId).toBe(80002);
    expect(d.verifyingContract).toBe('0x00000000000000000000000000000000000000A1');
  });

  it('UUID booking ids are hashed; hex ids pass through; deadline is ~1h out', () => {
    const p1 = signer.buildReleaseMilestonePayload({ bookingId: 'order-abc-123', milestoneId: 2, amountWei: 5000n, nonce: 3 });
    expect(p1.value.bookingId).toMatch(/^0x[0-9a-f]{64}$/);
    const p2 = signer.buildReleaseMilestonePayload({ bookingId: '0x' + 'ef'.repeat(32), milestoneId: 2, amountWei: 5000n, nonce: 3 });
    expect(p2.value.bookingId).toBe('0x' + 'ef'.repeat(32));
    expect(p2.value.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3000);
    expect(p2.types).toBe(EIP712_ESCROW_TYPES);
  });

  it('a real wallet signature verifies to the wallet address', () => {
    const wallet = ethers.Wallet.createRandom();
    const payload = signer.buildReleaseMilestonePayload({ bookingId: 'B-1', milestoneId: 1, amountWei: 100n, nonce: 0 });
    // sign synchronously via the wallet's signing key
    const signature = wallet.signingKey.sign(
      ethers.TypedDataEncoder.hash(payload.domain, payload.types, payload.value)
    ).serialized;
    const recovered = signer.verifySigner(payload, signature);
    expect(recovered).toBe(wallet.address);
  });

  it('a signature over a tampered payload recovers a DIFFERENT address', () => {
    const wallet = ethers.Wallet.createRandom();
    const payload = signer.buildReleaseMilestonePayload({ bookingId: 'B-1', milestoneId: 1, amountWei: 100n, nonce: 0 });
    const signature = wallet.signingKey.sign(
      ethers.TypedDataEncoder.hash(payload.domain, payload.types, payload.value)
    ).serialized;
    const tampered = { ...payload, value: { ...payload.value, amount: '999999' } };
    expect(signer.verifySigner(tampered, signature)).not.toBe(wallet.address);
  });

  it('malformed signatures throw a wrapped error', () => {
    const payload = signer.buildReleaseMilestonePayload({ bookingId: 'B-1', milestoneId: 1, amountWei: 100n, nonce: 0 });
    expect(() => signer.verifySigner(payload, '0xdeadbeef')).toThrow(/Invalid EIP-712/);
  });
});
