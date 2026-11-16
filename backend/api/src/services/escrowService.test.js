import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  paisaToMaticWei,
  weiWithinTolerance,
  resolveExpectedDepositAmount,
  getEscrowBookingId,
  ESCROW_MATIC_PER_PAISA
} from './escrowService.js';

describe('EscrowService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('paisaToMaticWei & weiWithinTolerance', () => {
    it('should correctly convert paisa to exact wei using integer arithmetic', () => {
      // Default rate: 0.000004 MATIC/paisa = 4,000,000,000,000 wei per paisa
      const paisa = 100; // ₹1
      const expectedWei = BigInt(100) * BigInt(Math.round(ESCROW_MATIC_PER_PAISA * 1e18));
      expect(paisaToMaticWei(paisa)).toBe(expectedWei);
    });

    it('should throw RangeError for negative or invalid paisa amounts', () => {
      expect(() => paisaToMaticWei(-10)).toThrow(RangeError);
      expect(() => paisaToMaticWei('invalid')).toThrow(RangeError);
      expect(() => paisaToMaticWei(null)).toThrow(TypeError);
    });

    it('should correctly evaluate wei within tolerance', () => {
      const base = 1000n;
      const within = 1000n + 500n; // 500 wei difference (< 1 gwei tolerance)
      const outside = 1000n + 2_000_000_000n; // 2 gwei difference (> 1 gwei tolerance)

      expect(weiWithinTolerance(base, within)).toBe(true);
      expect(weiWithinTolerance(base, outside)).toBe(false);
    });
  });

  describe('resolveExpectedDepositAmount', () => {
    it('should resolve expected amount from stored escrow_amount_wei and validate consistency', () => {
      const order = {
        escrow_amount_wei: '400000000000000',
        pending_bid_acceptance: { bid_amount: 100 }
      };
      const result = resolveExpectedDepositAmount(order);
      expect(result).toHaveProperty('expectedAmountWei');
      expect(result.expectedAmountWei).toBe(BigInt(order.escrow_amount_wei));
    });

    it('should return error when amount is inconsistent with pending bid', () => {
      const order = {
        escrow_amount_wei: '1000000000000000',
        pending_bid_acceptance: { bid_amount: 100 }
      };
      const result = resolveExpectedDepositAmount(order);
      expect(result).toHaveProperty('error');
      expect(result.code).toBe('ESCROW_AMOUNT_INCONSISTENT');
    });

    it('should return error when no escrow amount is recorded', () => {
      const order = {};
      const result = resolveExpectedDepositAmount(order);
      expect(result).toHaveProperty('error');
      expect(result.code).toBe('ESCROW_AMOUNT_MISSING');
    });
  });

  describe('getEscrowBookingId', () => {
    it('should generate a valid 32-byte keccak256 hex string for an order display ID', () => {
      const orderId = 'TRX-2026-9988';
      const bookingId = getEscrowBookingId(orderId);
      expect(bookingId).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });
});
