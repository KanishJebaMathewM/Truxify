/**
 * Integration tests for backend/api/src/services/escrow.js
 *
 * Tests the escrow service layer. Since the ethers.js Contract requires a
 * live blockchain RPC (not available in CI), these tests validate:
 *   - getEscrowBookingId(): deterministic bytes32 derivation
 *   - Graceful no-contract fallback: buildDepositTx returns {txData: null, bookingId},
 *     recordDepositTx returns {error}, escrowRelease/Refund return {txHash: null, bookingId}
 *     when POLYGON_RPC_URL / ESCROW_CONTRACT_ADDRESS / RELAYER_WALLET_PRIVATE_KEY
 *     are not configured (the default CI environment)
 *
 * Run with:  npm run test:integration -- test/integration/escrow.test.js
 */

import { describe, it, expect, vi } from 'vitest';

// Clear module cache to ensure we load a fresh instance of escrow.js
vi.resetModules();

// Back up and temporarily clear blockchain environment variables
// to force the no-contract fallback path in escrow.js
const oldRpcUrl = process.env.POLYGON_RPC_URL;
const oldContractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
const oldRelayerPrivateKey = process.env.RELAYER_WALLET_PRIVATE_KEY;

delete process.env.POLYGON_RPC_URL;
delete process.env.ESCROW_CONTRACT_ADDRESS;
delete process.env.RELAYER_WALLET_PRIVATE_KEY;

const {
  getEscrowBookingId,
  buildDepositTx,
  recordDepositTx,
  escrowRelease,
  escrowRefund,
} = await import('../../src/services/escrow.js');

// Restore environment variables
if (oldRpcUrl !== undefined) process.env.POLYGON_RPC_URL = oldRpcUrl;
if (oldContractAddress !== undefined) process.env.ESCROW_CONTRACT_ADDRESS = oldContractAddress;
if (oldRelayerPrivateKey !== undefined) process.env.RELAYER_WALLET_PRIVATE_KEY = oldRelayerPrivateKey;

const ORDER_ID_A = '#FF20260521';
const ORDER_ID_B = '#FF20260522';
const CUSTOMER_ADDR = '0x' + '2'.repeat(40);
const DRIVER_ADDR   = '0x' + '3'.repeat(40);
const AMOUNT_WEI    = '1000000000000000000';

// ── getEscrowBookingId ────────────────────────────────────────────────

describe('getEscrowBookingId()', () => {
  it('returns a 0x-prefixed 32-byte hex string', () => {
    const id = getEscrowBookingId(ORDER_ID_A);
    expect(id).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it('is deterministic — same input always produces same output', () => {
    expect(getEscrowBookingId(ORDER_ID_A)).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('produces different IDs for different order display IDs', () => {
    expect(getEscrowBookingId(ORDER_ID_A)).not.toBe(getEscrowBookingId(ORDER_ID_B));
  });

  it('encodes the escrow: prefix — raw ID differs from prefixed ID', () => {
    expect(getEscrowBookingId('FF20260521')).not.toBe(getEscrowBookingId('escrow:FF20260521'));
  });
});

// ── Graceful no-contract fallback ─────────────────────────────────────
// When blockchain env vars are absent, escrowContract is null and all
// functions return {txHash: null, bookingId} instead of throwing.

describe('buildDepositTx() — no-contract fallback', () => {
  it('returns {txData: null, bookingId} when contract not initialised', async () => {
    const result = await buildDepositTx(ORDER_ID_A, CUSTOMER_ADDR, DRIVER_ADDR, AMOUNT_WEI);
    expect(result.txData).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('returns {txData: null} for invalid customer address without throwing', async () => {
    const result = await buildDepositTx(ORDER_ID_A, 'invalid', DRIVER_ADDR, AMOUNT_WEI);
    expect(result.txData).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('returns {txData: null} for invalid driver address without throwing', async () => {
    const result = await buildDepositTx(ORDER_ID_A, CUSTOMER_ADDR, 'invalid', AMOUNT_WEI);
    expect(result.txData).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('bookingId is consistent with getEscrowBookingId()', async () => {
    const result = await buildDepositTx(ORDER_ID_B, CUSTOMER_ADDR, DRIVER_ADDR, AMOUNT_WEI);
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_B));
  });
});

describe('recordDepositTx() — no-contract fallback', () => {
  it('returns {error: "Contract not initialised"} when contract not configured', async () => {
    const result = await recordDepositTx(getEscrowBookingId(ORDER_ID_A), '0x' + 'a'.repeat(64));
    expect(result.error).toBe('Contract not initialised');
  });

  it('returns {error} for invalid transaction hash', async () => {
    const result = await recordDepositTx(getEscrowBookingId(ORDER_ID_A), 'invalid');
    expect(result.error).toBeDefined();
  });
});

describe('escrowRelease() — no-contract fallback', () => {
  it('returns {txHash: null, bookingId} when contract not initialised', async () => {
    const result = await escrowRelease(ORDER_ID_A);
    expect(result.txHash).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('bookingId matches getEscrowBookingId() for the same order', async () => {
    const result = await escrowRelease(ORDER_ID_B);
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_B));
  });

  it('is idempotent — multiple calls return same bookingId', async () => {
    const r1 = await escrowRelease(ORDER_ID_A);
    const r2 = await escrowRelease(ORDER_ID_A);
    expect(r1.bookingId).toBe(r2.bookingId);
  });
});

describe('escrowRefund() — no-contract fallback', () => {
  it('returns {txHash: null, bookingId} when contract not initialised', async () => {
    const result = await escrowRefund(ORDER_ID_A);
    expect(result.txHash).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('bookingId matches getEscrowBookingId() for the same order', async () => {
    const result = await escrowRefund(ORDER_ID_B);
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_B));
  });

  it('is idempotent — multiple calls return same bookingId', async () => {
    const r1 = await escrowRefund(ORDER_ID_A);
    const r2 = await escrowRefund(ORDER_ID_A);
    expect(r1.bookingId).toBe(r2.bookingId);
  });
});
