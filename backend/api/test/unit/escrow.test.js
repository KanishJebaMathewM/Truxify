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

// Safe module mock: preserves all real ethers exports, overrides only classes needed for instantiation.
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: vi.fn(function () { return global.__mockEthersContractInstance || {}; }),
      JsonRpcProvider: vi.fn(),
      Wallet: vi.fn(),
    }
  };
});

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

  it('converts large amounts without the removed 100 MATIC hard cap (env vars absent)', async () => {
    const rateEnv = process.env.ESCROW_MATIC_PER_PAISA;
    const capEnv = process.env.MAX_ESCROW_MATIC;
    delete process.env.ESCROW_MATIC_PER_PAISA;
    delete process.env.MAX_ESCROW_MATIC;

    vi.resetModules();
    const { paisaToMaticWei: defaultRateWei } = await import('../../src/services/escrow.js');

    // 10,000,000 paisa (₹100k) × 0.000004 = 40 MATIC — a realistic large order.
    expect(defaultRateWei(10_000_000)).toBe(ethers.parseEther('40'));

    // Previously the 100 MATIC cap (~Rs.250,000) made this throw a RangeError,
    // silently breaking escrow for high-value shipments. The cap is removed so
    // large/high-value orders convert correctly instead of throwing.
    const bigPaisa = 100_000_000_000; // ₹1B @ default rate = 400,000 MATIC
    expect(() => defaultRateWei(bigPaisa)).not.toThrow();
    expect(defaultRateWei(bigPaisa)).toBe(BigInt(bigPaisa) * 4_000_000_000_000n);

    if (rateEnv !== undefined) process.env.ESCROW_MATIC_PER_PAISA = rateEnv;
    else delete process.env.ESCROW_MATIC_PER_PAISA;
    if (capEnv !== undefined) process.env.MAX_ESCROW_MATIC = capEnv;
    else delete process.env.MAX_ESCROW_MATIC;
    vi.resetModules();
  });

  it('converts a high-value shipment above the old 100 MATIC cap (issue #14682)', () => {
    // 62,500,000 paisa (₹625,000) × 0.000004 = 250 MATIC — above the old cap
    // that broke escrow for shipments above ~Rs.250,000.
    const paisa = 62_500_000;
    const wei = paisaToMaticWei(paisa);
    expect(wei).toBe(ethers.parseEther('250'));
    expect(wei).toBe(BigInt(paisa) * 4_000_000_000_000n);
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

describe('escrow service — setEscrowContractPaused (on-chain pause)', () => {
  let pauseStub, unpauseStub, pausedStub, waitStub;

  beforeEach(() => {
    vi.resetModules();

    // Set env vars so escrowContract is initialized on module load
    process.env.POLYGON_RPC_URL = 'http://mock-rpc';
    process.env.ESCROW_CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + 'a'.repeat(64);

    waitStub = vi.fn().mockResolvedValue({ status: 1, hash: '0xreceipt', blockNumber: 1 });
    pauseStub = vi.fn().mockResolvedValue({ hash: '0xtx', wait: waitStub });
    unpauseStub = vi.fn().mockResolvedValue({ hash: '0xtx', wait: waitStub });
    pausedStub = vi.fn().mockResolvedValue(false);

    global.__mockEthersContractInstance = {
       pause: pauseStub,
       unpause: unpauseStub,
       paused: pausedStub,
       runner: { provider: { getNetwork: async () => ({ chainId: 137 }) } }
    };
  });

  afterEach(() => {
    delete process.env.POLYGON_RPC_URL;
    delete process.env.ESCROW_CONTRACT_ADDRESS;
    delete process.env.RELAYER_WALLET_PRIVATE_KEY;
    global.__mockEthersContractInstance = undefined;
    vi.restoreAllMocks();
  });

  it('returns error when contract is uninitialized', async () => {
    delete process.env.POLYGON_RPC_URL;
    // Because of vi.resetModules(), deleting the env var BEFORE import guarantees
    // escrowContract initializes to null in the fresh module evaluation.
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    const res = await setEscrowContractPaused(true);
    expect(res.error).toContain('Escrow contract is not initialised');
  });

  it('skips transaction if already in requested state', async () => {
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    pausedStub.mockResolvedValue(true);
    const res = await setEscrowContractPaused(true);
    expect(pauseStub).not.toHaveBeenCalled();
    expect(res).toEqual({ success: true, alreadyInState: true });
  });

  it('submits pause transaction and verifies state', async () => {
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    pausedStub.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await setEscrowContractPaused(true);
    expect(pauseStub).toHaveBeenCalled();
    expect(waitStub).toHaveBeenCalledWith(1);
    expect(res).toEqual({ success: true, txHash: '0xreceipt' });
  });

  it('submits unpause transaction and verifies state', async () => {
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    pausedStub.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await setEscrowContractPaused(false);
    expect(unpauseStub).toHaveBeenCalled();
    expect(waitStub).toHaveBeenCalledWith(1);
    expect(res).toEqual({ success: true, txHash: '0xreceipt' });
  });

  it('fails if tx submission fails', async () => {
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    pauseStub.mockRejectedValue(new Error('Network error'));
    const res = await setEscrowContractPaused(true);
    expect(res.error).toContain('Network error');
  });

  it('fails if tx receipt status is 0 (reverted)', async () => {
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    waitStub.mockResolvedValue({ status: 0 });
    const res = await setEscrowContractPaused(true);
    expect(res.error).toContain('reverted or not found');
  });

  it('fails if tx receipt is missing', async () => {
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    waitStub.mockResolvedValue(null);
    const res = await setEscrowContractPaused(true);
    expect(res.error).toContain('reverted or not found');
  });

  it('fails if paused() remains false after pause tx succeeds (regression)', async () => {
    const { setEscrowContractPaused } = await import('../../src/services/escrow.js');
    pausedStub.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const res = await setEscrowContractPaused(true);
    expect(waitStub).toHaveBeenCalledWith(1);
    expect(res.error).toContain('Transaction succeeded but contract paused() is still false');
  });
});
