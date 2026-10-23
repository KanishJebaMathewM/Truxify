/**
 * Unit tests for backend/api/src/services/lumperEscrowService.js
 *
 * The service previously trusted every amount it was handed:
 *   - `estimated_fee: 'abc'` was stored as NaN,
 *   - `estimated_fee: -500` created a negative escrow,
 *   - a release claim larger than the escrowed amount was paid out verbatim,
 *   - a released escrow could be released again.
 *
 * Run with:  npm test -- test/unit/lumperEscrowService.test.js
 */
import { describe, it, expect, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

const { lumperEscrowService } = await import('../../src/services/lumperEscrowService.js');
const { ValidationError } = await import('../../src/utils/errors.js');

async function deposit(estimatedFeeAmount = 500) {
  return lumperEscrowService.depositLumperFee({
    bookingId: 'BK-1',
    brokerAddress: '0xBroker',
    estimatedFeeAmount,
  });
}

describe('lumperEscrowService.depositLumperFee', () => {
  it('stores a valid positive fee', async () => {
    const escrow = await deposit(1500);
    expect(escrow.estimatedFeeAmount).toBe(1500);
    expect(escrow.status).toBe('HELD_IN_ESCROW');
    expect(escrow.releasedAmount).toBeUndefined();
  });

  it('coerces numeric strings', async () => {
    const escrow = await lumperEscrowService.depositLumperFee({
      bookingId: 'BK-2',
      brokerAddress: '0xBroker',
      estimatedFeeAmount: '750.25',
    });
    expect(escrow.estimatedFeeAmount).toBe(750.25);
  });

  it('rejects a non-numeric fee instead of storing NaN', async () => {
    await expect(deposit('abc')).rejects.toThrow(ValidationError);
    await expect(deposit(NaN)).rejects.toThrow(/finite/);
    await expect(deposit(Infinity)).rejects.toThrow(/finite/);
  });

  it('rejects a negative fee', async () => {
    await expect(deposit(-500)).rejects.toThrow(/greater than 0/);
  });

  it('rejects a zero fee', async () => {
    await expect(deposit(0)).rejects.toThrow(/greater than 0/);
  });
});

describe('lumperEscrowService.processReceiptAndRelease', () => {
  it('releases the escrowed amount when no claim is supplied', async () => {
    const escrow = await deposit(500);
    const released = await lumperEscrowService.processReceiptAndRelease({
      escrowId: escrow.escrowId,
      driverWallet: '0xDriver',
      receiptImageUrl: 'https://example.test/receipt.jpg',
    });
    expect(released.status).toBe('RELEASED');
    expect(released.releasedAmount).toBe(500);
  });

  it('releases a claim that is within the escrowed amount', async () => {
    const escrow = await deposit(500);
    const released = await lumperEscrowService.processReceiptAndRelease({
      escrowId: escrow.escrowId,
      driverWallet: '0xDriver',
      receiptImageUrl: 'https://example.test/receipt.jpg',
      claimedAmount: 420,
    });
    expect(released.releasedAmount).toBe(420);
  });

  it('allows a claim exactly equal to the escrowed amount', async () => {
    const escrow = await deposit(500);
    const released = await lumperEscrowService.processReceiptAndRelease({
      escrowId: escrow.escrowId,
      driverWallet: '0xDriver',
      receiptImageUrl: 'https://example.test/receipt.jpg',
      claimedAmount: 500,
    });
    expect(released.releasedAmount).toBe(500);
  });

  it('rejects a claim larger than the escrowed amount', async () => {
    const escrow = await deposit(500);
    await expect(
      lumperEscrowService.processReceiptAndRelease({
        escrowId: escrow.escrowId,
        driverWallet: '0xDriver',
        receiptImageUrl: 'https://example.test/receipt.jpg',
        claimedAmount: 99999999,
      }),
    ).rejects.toThrow(/cannot exceed/);

    // The escrow must be untouched after the rejected claim.
    const still = await lumperEscrowService.getEscrowStatus(escrow.escrowId);
    expect(still.status).toBe('HELD_IN_ESCROW');
    expect(still.releasedAmount).toBeUndefined();
  });

  it('rejects a negative claim instead of recording a negative payout', async () => {
    const escrow = await deposit(500);
    await expect(
      lumperEscrowService.processReceiptAndRelease({
        escrowId: escrow.escrowId,
        driverWallet: '0xDriver',
        receiptImageUrl: 'https://example.test/receipt.jpg',
        claimedAmount: -100,
      }),
    ).rejects.toThrow(/greater than 0/);
  });

  it('rejects a NaN claim instead of silently paying the full escrow', async () => {
    const escrow = await deposit(500);
    await expect(
      lumperEscrowService.processReceiptAndRelease({
        escrowId: escrow.escrowId,
        driverWallet: '0xDriver',
        receiptImageUrl: 'https://example.test/receipt.jpg',
        claimedAmount: 'abc',
      }),
    ).rejects.toThrow(/finite/);
  });

  it('rejects a zero claim', async () => {
    const escrow = await deposit(500);
    await expect(
      lumperEscrowService.processReceiptAndRelease({
        escrowId: escrow.escrowId,
        driverWallet: '0xDriver',
        receiptImageUrl: 'https://example.test/receipt.jpg',
        claimedAmount: 0,
      }),
    ).rejects.toThrow(/greater than 0/);
  });

  it('rejects an unknown escrow', async () => {
    await expect(
      lumperEscrowService.processReceiptAndRelease({
        escrowId: 'LMP-does-not-exist',
        driverWallet: '0xDriver',
        receiptImageUrl: 'https://example.test/receipt.jpg',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('refuses to release the same escrow twice', async () => {
    const escrow = await deposit(500);
    const release = () => lumperEscrowService.processReceiptAndRelease({
      escrowId: escrow.escrowId,
      driverWallet: '0xDriver',
      receiptImageUrl: 'https://example.test/receipt.jpg',
    });

    await release();
    await expect(release()).rejects.toThrow(/already been released/);
  });
});

describe('lumperEscrowService.getEscrowStatus', () => {
  it('returns null for an unknown escrow', async () => {
    expect(await lumperEscrowService.getEscrowStatus('nope')).toBeNull();
  });
});
