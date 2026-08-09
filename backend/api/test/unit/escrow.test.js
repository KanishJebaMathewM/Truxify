/**
 * Unit tests for backend/api/src/services/escrow.js
 *
 * Coverage:
 *   - getEscrowBookingId: output shape, determinism, prefix, uniqueness
 *   - buildDepositTx: graceful fallback when contract is unconfigured,
 *     invalid address validation, invalid amount validation
 *   - confirmEscrowRefund: throws when contract not initialised
 *   - validateEscrowSetup: returns false when contract not configured
 *
 * Run with:  npm test -- test/unit/escrow.test.js
 */
import { describe, it, expect, vi } from 'vitest'
import { ethers } from 'ethers'
import {
  getEscrowBookingId,
  buildDepositTx,
  escrowRelease,
  submitEscrowRefund,
  confirmEscrowRefund,
  ESCROW_MATIC_PER_PAISA,
  paisaToMaticWei,
  validateEscrowSetup,
  isEscrowEnabled,
  submitEscrowRaiseDispute,
  submitEscrowResolveDispute,
  submitEscrowResolveDisputeTimeout,
  markEscrowBookingStarted,
} from '../../src/services/escrow.js'

describe('escrow service — getEscrowBookingId', () => {
  it('returns a hex string prefixed with 0x', () => {
    const result = getEscrowBookingId('#FF20260521')
    expect(typeof result).toBe('string')
    expect(result.startsWith('0x')).toBe(true)
  })

  it('returns a 66-character hex string (bytes32)', () => {
    const result = getEscrowBookingId('#FF20260521')
    expect(result.length).toBe(66)
    expect(/^0x[0-9a-f]{64}$/.test(result)).toBe(true)
  })

  it('is deterministic for the same input', () => {
    const id = '#FF20260521'
    const first = getEscrowBookingId(id)
    const second = getEscrowBookingId(id)
    expect(first).toBe(second)
  })

  it('produces different outputs for different inputs', () => {
    const id1 = '#FF20260521'
    const id2 = '#FF20260522'
    expect(getEscrowBookingId(id1)).not.toBe(getEscrowBookingId(id2))
  })

  it('ESCROW_MATIC_PER_PAISA parses the configured env var correctly', () => {
    // process.env.ESCROW_MATIC_PER_PAISA is set to '0.000004' in setup.js
    expect(ESCROW_MATIC_PER_PAISA).toBe(0.000004)
  })

  it('ESCROW_MATIC_PER_PAISA defaults to 0.000004 when env var is absent', async () => {
    const originalEnv = process.env.ESCROW_MATIC_PER_PAISA
    delete process.env.ESCROW_MATIC_PER_PAISA

    vi.resetModules()
    const { ESCROW_MATIC_PER_PAISA: defaultVal } = await import('../../src/services/escrow.js')
    expect(defaultVal).toBe(0.000004)

    if (originalEnv !== undefined) {
      process.env.ESCROW_MATIC_PER_PAISA = originalEnv
    }
    vi.resetModules()
  })

  it('ESCROW_MATIC_PER_PAISA parses a custom value correctly', async () => {
    const originalEnv = process.env.ESCROW_MATIC_PER_PAISA
    process.env.ESCROW_MATIC_PER_PAISA = '0.05'

    vi.resetModules()
    const { ESCROW_MATIC_PER_PAISA: customVal } = await import('../../src/services/escrow.js')
    expect(customVal).toBe(0.05)

    if (originalEnv !== undefined) {
      process.env.ESCROW_MATIC_PER_PAISA = originalEnv
    } else {
      delete process.env.ESCROW_MATIC_PER_PAISA
    }
    vi.resetModules()
  })
})

describe('escrow service — paisaToMaticWei', () => {
  it('converts paisa to wei using the configured rate (0.000004 MATIC/paisa)', () => {
    // 100 paisa × 0.000004 = 0.0004 MATIC = 4 × 10^14 wei
    const wei = paisaToMaticWei(100);
    expect(wei).toBe(400_000_000_000_000n);
  });

  it('converts 1 paisa to 0.000004 MATIC (4 × 10^12 wei)', () => {
    const wei = paisaToMaticWei(1);
    expect(typeof wei).toBe('bigint');
    expect(wei).toBe(4_000_000_000_000n);
  });

  it('converts 250000 paisa (₹2500) to 1 MATIC', () => {
    // 250000 × 0.000004 = 1 MATIC
    const wei = paisaToMaticWei(250_000);
    expect(wei).toBe(ethers.parseEther('1'));
  });

  it('returns 0n for 0 paisa', () => {
    const wei = paisaToMaticWei(0);
    expect(wei).toBe(0n);
  });

  it('throws RangeError for negative paisa', () => {
    expect(() => paisaToMaticWei(-100)).toThrow(RangeError);
  });

  it('throws RangeError for NaN paisa', () => {
    expect(() => paisaToMaticWei(NaN)).toThrow(RangeError);
  });

  it('throws RangeError for Infinity paisa', () => {
    expect(() => paisaToMaticWei(Infinity)).toThrow(RangeError);
  });

  it('throws RangeError for non-numeric strings', () => {
    expect(() => paisaToMaticWei('not-a-number')).toThrow(RangeError);
  });

  it('handles string input for paisa', () => {
    const wei = paisaToMaticWei('100');
    expect(wei).toBe(400_000_000_000_000n);
  });

  it('enforces the default 100 MATIC safety cap when env vars are absent', async () => {
    const rateEnv = process.env.ESCROW_MATIC_PER_PAISA;
    const capEnv = process.env.MAX_ESCROW_MATIC;
    delete process.env.ESCROW_MATIC_PER_PAISA;
    delete process.env.MAX_ESCROW_MATIC;

    vi.resetModules();
    const { paisaToMaticWei: defaultRateWei } = await import('../../src/services/escrow.js');

    // 10,000,000 paisa (₹100k) × 0.000004 = 40 MATIC — a realistic large
    // order that is now well under the default 100 MATIC cap, no RangeError.
    expect(defaultRateWei(10_000_000)).toBe(ethers.parseEther('40'));
    // An order far beyond the cap is rejected with a handled RangeError.
    expect(() => defaultRateWei(100_000_000_000)).toThrow(RangeError);

    if (rateEnv !== undefined) process.env.ESCROW_MATIC_PER_PAISA = rateEnv;
    else delete process.env.ESCROW_MATIC_PER_PAISA;
    if (capEnv !== undefined) process.env.MAX_ESCROW_MATIC = capEnv;
    else delete process.env.MAX_ESCROW_MATIC;
    vi.resetModules();
  });

  it('converts using a custom rate when env var is overridden', async () => {
    const originalEnv = process.env.ESCROW_MATIC_PER_PAISA;
    process.env.ESCROW_MATIC_PER_PAISA = '0.05';

    vi.resetModules();
    const { paisaToMaticWei: customRateWei } = await import('../../src/services/escrow.js');

    // 100 paisa × 0.05 = 5 MATIC = 5 * 10^18 wei
    const wei = customRateWei(100);
    expect(wei).toBe(ethers.parseEther('5'));

    if (originalEnv !== undefined) {
      process.env.ESCROW_MATIC_PER_PAISA = originalEnv;
    } else {
      delete process.env.ESCROW_MATIC_PER_PAISA;
    }
    vi.resetModules();
  });
});

describe('escrow service — isEscrowEnabled', () => {
  it('returns false when blockchain env vars are not set (escrowContract is null)', () => {
    expect(isEscrowEnabled()).toBe(false);
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
    )
    expect(txData).toBeNull()
    expect(typeof bookingId).toBe('string')
    expect(bookingId.startsWith('0x')).toBe(true)
  })

  it('returns txData: null and a valid bookingId for an invalid customer wallet address', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260522',
      'not-an-address',
      '0x0000000000000000000000000000000000000002',
      '1000000000000000000'
    )
    expect(txData).toBeNull()
    expect(typeof bookingId).toBe('string')
    expect(bookingId.startsWith('0x')).toBe(true)
  })

  it('returns txData: null for an invalid driver wallet address', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260523',
      '0x0000000000000000000000000000000000000001',
      'invalid-driver',
      '1000000000000000000'
    )
    expect(txData).toBeNull()
    expect(typeof bookingId).toBe('string')
    expect(bookingId.startsWith('0x')).toBe(true)
  })

  it('returns txData: null when amountWei is zero', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260524',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '0'
    )
    expect(txData).toBeNull()
    expect(typeof bookingId).toBe('string')
    expect(bookingId.startsWith('0x')).toBe(true)
  })

  it('returns txData: null when amountWei is falsy', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260525',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      null
    )
    expect(txData).toBeNull()
    expect(typeof bookingId).toBe('string')
    expect(bookingId.startsWith('0x')).toBe(true)
  })

  it('returns txData: null when amountWei is negative (BigInt)', async () => {
    const { txData, bookingId } = await buildDepositTx(
      '#FF20260526',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '-1000000000000000000'
    )
    expect(txData).toBeNull()
    expect(typeof bookingId).toBe('string')
    expect(bookingId.startsWith('0x')).toBe(true)
  })
})

// escrowContract is null in the test environment (no POLYGON_RPC_URL / ESCROW_CONTRACT_ADDRESS /
// RELAYER_WALLET_PRIVATE_KEY set in setup.js) — test the graceful fallback paths.

describe('escrow service \u2014 escrowRelease (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const { txHash, bookingId } = await escrowRelease('#FF20260527')
    expect(txHash).toBeNull()
    expect(typeof bookingId).toBe('string')
    expect(bookingId.startsWith('0x')).toBe(true)
  })

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const { bookingId } = await escrowRelease('#FF20260528')
    const expected = getEscrowBookingId('#FF20260528')
    expect(bookingId).toBe(expected)
  })
})

describe('escrow service \u2014 submitEscrowRefund (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const result = await submitEscrowRefund('#FF20260529')
    expect(result.txHash).toBeNull()
    expect(typeof result.bookingId).toBe('string')
    expect(result.bookingId.startsWith('0x')).toBe(true)
  })

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const result = await submitEscrowRefund('#FF20260530')
    const expected = getEscrowBookingId('#FF20260530')
    expect(result.bookingId).toBe(expected)
  })
})

describe('escrow service \u2014 submitEscrowRaiseDispute (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const result = await submitEscrowRaiseDispute('#FF20260601')
    expect(result.txHash).toBeNull()
    expect(typeof result.bookingId).toBe('string')
    expect(result.bookingId.startsWith('0x')).toBe(true)
  })

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const result = await submitEscrowRaiseDispute('#FF20260602')
    const expected = getEscrowBookingId('#FF20260602')
    expect(result.bookingId).toBe(expected)
  })
})

describe('escrow service \u2014 submitEscrowResolveDispute (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const result = await submitEscrowResolveDispute('#FF20260603', '600000000000000000')
    expect(result.txHash).toBeNull()
    expect(typeof result.bookingId).toBe('string')
    expect(result.bookingId.startsWith('0x')).toBe(true)
  })

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const result = await submitEscrowResolveDispute('#FF20260604', 0)
    const expected = getEscrowBookingId('#FF20260604')
    expect(result.bookingId).toBe(expected)
  })
})

describe('escrow service \u2014 submitEscrowResolveDisputeTimeout (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const result = await submitEscrowResolveDisputeTimeout('#FF20260605')
    expect(result.txHash).toBeNull()
    expect(typeof result.bookingId).toBe('string')
    expect(result.bookingId.startsWith('0x')).toBe(true)
  })

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const result = await submitEscrowResolveDisputeTimeout('#FF20260606')
    const expected = getEscrowBookingId('#FF20260606')
    expect(result.bookingId).toBe(expected)
  })
})

describe('escrow service \u2014 confirmEscrowRefund (contract unconfigured)', () => {
  it('throws when contract is not initialised', async () => {
    await expect(confirmEscrowRefund('0x' + 'a'.repeat(64))).rejects.toThrow(
      'Escrow contract is not initialised.'
    )
  })

  it('throws for non-hex string input', async () => {
    await expect(confirmEscrowRefund('not-a-hash')).rejects.toThrow(
      'Escrow contract is not initialised.'
    )
  })
})

describe('escrow service \u2014 validateEscrowSetup (contract unconfigured)', () => {
  it('returns false when ESCROW_CONTRACT_ADDRESS env vars are missing', async () => {
    const result = await validateEscrowSetup()
    expect(result).toBe(false)
  })
})

describe('escrow service — escrowRelease (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const result = await escrowRelease('#FF20260607')
    expect(result.txHash).toBeNull()
    expect(typeof result.bookingId).toBe('string')
    expect(result.bookingId.startsWith('0x')).toBe(true)
  })

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const result = await escrowRelease('#FF20260608')
    const expected = getEscrowBookingId('#FF20260608')
    expect(result.bookingId).toBe(expected)
  })
})

describe('escrow service — markEscrowBookingStarted (contract unconfigured)', () => {
  it('returns txHash: null and a valid bookingId when contract is not initialised', async () => {
    const result = await markEscrowBookingStarted('#FF20260609')
    expect(result.txHash).toBeNull()
    expect(typeof result.bookingId).toBe('string')
    expect(result.bookingId.startsWith('0x')).toBe(true)
  })

  it('returns the same bookingId as getEscrowBookingId', async () => {
    const result = await markEscrowBookingStarted('#FF20260610')
    const expected = getEscrowBookingId('#FF20260610')
    expect(result.bookingId).toBe(expected)
  })
})
