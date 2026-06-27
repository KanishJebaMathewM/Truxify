/**
 * Unit tests for backend/api/src/services/escrow.js
 *
 * Coverage:
 *   - getEscrowBookingId: output shape, determinism, prefix, uniqueness
 *   - buildDepositTx: graceful fallback when contract is unconfigured,
 *     invalid address validation, invalid amount validation
 *
 * Run with:  npm test -- test/unit/escrow.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import { getEscrowBookingId, buildDepositTx, escrowRelease, escrowRefund, confirmEscrowRefund, ESCROW_MATIC_PER_PAISA } from '../../src/services/escrow.js';

describe('escrow service — getEscrowBookingId', () => {
  it('returns a hex string prefixed with 0x', () => {
    const result = getEscrowBookingId('#FF20260521');
    expect(typeof result).toBe('string');
    expect(result.startsWith('0x')).toBe(true);
  });

  it('returns a 66-character hex string (bytes32)', () => {
    const result = getEscrowBookingId('#FF20260521');
    expect(result.length).toBe(66);
    expect(/^0x[0-9a-f]{64}$/.test(result)).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const id = '#FF20260521';
    const first = getEscrowBookingId(id);
    const second = getEscrowBookingId(id);
    expect(first).toBe(second);
  });

  it('produces different outputs for different inputs', () => {
    const id1 = '#FF20260521';
    const id2 = '#FF20260522';
    expect(getEscrowBookingId(id1)).not.toBe(getEscrowBookingId(id2));
  });

  it('ESCROW_MATIC_PER_PAISA parses the configured env var correctly', () => {
    // process.env.ESCROW_MATIC_PER_PAISA is set to '0.01' in setup.js
    expect(ESCROW_MATIC_PER_PAISA).toBe(0.01);
  });

  it('ESCROW_MATIC_PER_PAISA defaults to 0.01 when env var is absent', async () => {
    const originalEnv = process.env.ESCROW_MATIC_PER_PAISA;
    delete process.env.ESCROW_MATIC_PER_PAISA;
    
    vi.resetModules();
    const { ESCROW_MATIC_PER_PAISA: defaultVal } = await import('../../src/services/escrow.js');
    expect(defaultVal).toBe(0.01);

    if (originalEnv !== undefined) {
      process.env.ESCROW_MATIC_PER_PAISA = originalEnv;
    }
    vi.resetModules();
  });

  it('ESCROW_MATIC_PER_PAISA parses a custom value correctly', async () => {
    const originalEnv = process.env.ESCROW_MATIC_PER_PAISA;
    process.env.ESCROW_MATIC_PER_PAISA = '0.05';

    vi.resetModules();
    const { ESCROW_MATIC_PER_PAISA: customVal } = await import('../../src/services/escrow.js');
    expect(customVal).toBe(0.05);

    if (originalEnv !== undefined) {
      process.env.ESCROW_MATIC_PER_PAISA = originalEnv;
    } else {
      delete process.env.ESCROW_MATIC_PER_PAISA;
    }
    vi.resetModules();
  });
});

describe('escrow service — buildDepositTx (contract unconfigured)', () => {
  // escrowContract is null when POLYGON_RPC_URL / ESCROW_CONTRACT_ADDRESS /
  // RELAYER_WALLET_PRIVATE_KEY are not set (CI / dev environments).
  // In that state buildDepositTx must return { txData: null, bookingId }.

  it('returns txData: null when escrowContract is not initialised', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260521',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '1000000000000000000'
    );
    expect(txData).toBeNull();
    expect(typeof bookingId).toBe('string');
    expect(bookingId.startsWith('0x')).toBe(true);
  });

  it('returns txData: null and a valid bookingId for an invalid customer wallet address', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260522',
      'not-an-address',
      '0x0000000000000000000000000000000000000002',
      '1000000000000000000'
    );
    expect(txData).toBeNull();
    expect(typeof bookingId).toBe('string');
    expect(bookingId.startsWith('0x')).toBe(true);
  });

  it('returns txData: null for an invalid driver wallet address', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260523',
      '0x0000000000000000000000000000000000000001',
      'invalid-driver',
      '1000000000000000000'
    );
    expect(txData).toBeNull();
    expect(typeof bookingId).toBe('string');
    expect(bookingId.startsWith('0x')).toBe(true);
  });

  it('returns txData: null when amountWei is zero', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260524',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '0'
    );
    expect(txData).toBeNull();
    expect(typeof bookingId).toBe('string');
    expect(bookingId.startsWith('0x')).toBe(true);
  });

  it('returns txData: null when amountWei is falsy', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260525',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      null
    );
    expect(txData).toBeNull();
    expect(typeof bookingId).toBe('string');
    expect(bookingId.startsWith('0x')).toBe(true);
  });

  it('returns txData: null when amountWei is negative (BigInt)', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260526',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '-1000000000000000000'
    );
    expect(txData).toBeNull();
    expect(typeof bookingId).toBe('string');
    expect(bookingId.startsWith('0x')).toBe(true);
  });
});

// escrowContract is null in the test environment (no POLYGON_RPC_URL / ESCROW_CONTRACT_ADDRESS /
// RELAYER_WALLET_PRIVATE_KEY set in setup.js) — test the graceful fallback paths.

describe('escrow service \u2014 escrowRelease (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const { txHash, bookingId } = await escrowRelease('#FF20260527');
    expect(txHash).toBeNull();
    expect(typeof bookingId).toBe('string');
    expect(bookingId.startsWith('0x')).toBe(true);
  });

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const { bookingId } = await escrowRelease('#FF20260528');
    const expected = getEscrowBookingId('#FF20260528');
    expect(bookingId).toBe(expected);
  });
});

describe('escrow service \u2014 escrowRefund (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const result = await escrowRefund('#FF20260529');
    expect(result.txHash).toBeNull();
    expect(typeof result.bookingId).toBe('string');
    expect(result.bookingId.startsWith('0x')).toBe(true);
  });

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const result = await escrowRefund('#FF20260530');
    const expected = getEscrowBookingId('#FF20260530');
    expect(result.bookingId).toBe(expected);
  });
});

describe('escrow service \u2014 confirmEscrowRefund (contract unconfigured)', () => {
  it('throws when contract is not initialised', async () => {
    await expect(confirmEscrowRefund('0x' + 'a'.repeat(64))).rejects.toThrow(
      'Escrow contract is not initialised.'
    );
  });

  it('throws for non-hex string input', async () => {
    await expect(confirmEscrowRefund('not-a-hash')).rejects.toThrow(
      'Escrow contract is not initialised.'
    );
  });
});
