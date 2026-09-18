import { describe, it, expect } from 'vitest';
import {
  verifyEscrowSender,
  verifyDepositSender,
  verifySender,
  extractSenderAddress,
} from '../../src/services/escrowSenderVerification.js';

describe('escrowSenderVerification', () => {
  const validSender = '0x1234567890123456789012345678901234567890';
  const validExpected = '0x1234567890123456789012345678901234567890';
  const differentExpected = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

  describe('null / undefined guards', () => {
    it('returns structured error when sender is null', () => {
      const result = verifyEscrowSender(null, validExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SENDER_REQUIRED');
      expect(result.error).toMatch(/Sender is required/i);
    });

    it('returns structured error when sender is undefined', () => {
      const result = verifyEscrowSender(undefined, validExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SENDER_REQUIRED');
      expect(result.error).toMatch(/Sender is required/i);
    });

    it('guards against null sender in verifyDepositSender', () => {
      const result = verifyDepositSender(null, validExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SENDER_REQUIRED');
    });

    it('guards against undefined sender in verifyDepositSender', () => {
      const result = verifyDepositSender(undefined, validExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SENDER_REQUIRED');
    });

    it('guards against null sender in verifySender', () => {
      const result = verifySender(null, validExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SENDER_REQUIRED');
    });

    it('guards against undefined sender in verifySender', () => {
      const result = verifySender(undefined, validExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SENDER_REQUIRED');
    });

    it('extractSenderAddress returns null for falsy sender', () => {
      expect(extractSenderAddress(null)).toBeNull();
      expect(extractSenderAddress(undefined)).toBeNull();
      expect(extractSenderAddress('')).toBeNull();
    });
  });

  describe('address extraction from strings and objects', () => {
    it('extracts valid string address', () => {
      expect(extractSenderAddress(validSender)).toBe(validSender.toLowerCase());
      expect(extractSenderAddress(`  ${validSender}  `)).toBe(validSender.toLowerCase());
    });

    it('extracts address from sender object with address, walletAddress, or from properties', () => {
      expect(extractSenderAddress({ address: validSender })).toBe(validSender.toLowerCase());
      expect(extractSenderAddress({ walletAddress: validSender })).toBe(validSender.toLowerCase());
      expect(extractSenderAddress({ from: validSender })).toBe(validSender.toLowerCase());
    });

    it('returns null for invalid address formats', () => {
      expect(extractSenderAddress('not-an-address')).toBeNull();
      expect(extractSenderAddress({ address: 'invalid' })).toBeNull();
      expect(extractSenderAddress({})).toBeNull();
    });
  });

  describe('sender matching and error cases', () => {
    it('succeeds when sender matches expected address', () => {
      const result = verifyEscrowSender(validSender, validExpected);
      expect(result.valid).toBe(true);
      expect(result.success).toBe(true);
      expect(result.sender).toBe(validSender.toLowerCase());
      expect(result.expected).toBe(validExpected.toLowerCase());
    });

    it('succeeds when sender object matches expected address case-insensitively', () => {
      const result = verifyDepositSender({ from: validSender.toUpperCase() }, validExpected.toLowerCase());
      expect(result.valid).toBe(true);
      expect(result.success).toBe(true);
    });

    it('fails with SENDER_MISMATCH when sender does not match expected address', () => {
      const result = verifyEscrowSender(validSender, differentExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SENDER_MISMATCH');
      expect(result.error).toMatch(/does not match/i);
    });

    it('fails when expected address is missing or invalid', () => {
      const result = verifyEscrowSender(validSender, null);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('EXPECTED_ADDRESS_MISSING');
    });

    it('fails when sender is an object with invalid address', () => {
      const result = verifyEscrowSender({ address: '0xinvalid' }, validExpected);
      expect(result.valid).toBe(false);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_SENDER_ADDRESS');
    });
  });
});
