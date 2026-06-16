/**
 * Integration tests for backend/api/src/services/escrow.js
 *
 * Tests the escrow service layer. Since the ethers.js Contract requires a
 * live blockchain RPC (not available in CI), these tests validate:
 *   - getEscrowBookingId(): deterministic bytes32 derivation
 *   - Graceful no-contract fallback: all functions return {txHash: null, bookingId}
 *     when POLYGON_RPC_URL / ESCROW_CONTRACT_ADDRESS / RELAYER_WALLET_PRIVATE_KEY
 *     are not configured (the default CI environment)
 *   - Blockchain interactions are mocked via vi.mock in bids.test.js for
 *     full order lifecycle testing (escrowDeposit, escrowRefund on bid accept)
 *
 * Run with:  npm run test:integration -- test/integration/escrow.test.js
 */

import { describe, it, expect } from 'vitest';

// Import without blockchain env vars so escrowContract = null (safe CI mode)
// The module-level init warning is expected and suppressed by test/setup.js
const {
  getEscrowBookingId,
  escrowDeposit,
  escrowRelease,
  escrowRefund,
} = await import('../../src/services/escrow.js');

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

describe('escrowDeposit() — no-contract fallback', () => {
  it('returns {txHash: null, bookingId} when contract not initialised', async () => {
    const result = await escrowDeposit(ORDER_ID_A, CUSTOMER_ADDR, DRIVER_ADDR, AMOUNT_WEI);
    expect(result.txHash).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('returns {txHash: null} for invalid customer address without throwing', async () => {
    const result = await escrowDeposit(ORDER_ID_A, 'invalid', DRIVER_ADDR, AMOUNT_WEI);
    expect(result.txHash).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('returns {txHash: null} for invalid driver address without throwing', async () => {
    const result = await escrowDeposit(ORDER_ID_A, CUSTOMER_ADDR, 'invalid', AMOUNT_WEI);
    expect(result.txHash).toBeNull();
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_A));
  });

  it('bookingId is consistent with getEscrowBookingId()', async () => {
    const result = await escrowDeposit(ORDER_ID_B, CUSTOMER_ADDR, DRIVER_ADDR, AMOUNT_WEI);
    expect(result.bookingId).toBe(getEscrowBookingId(ORDER_ID_B));
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
