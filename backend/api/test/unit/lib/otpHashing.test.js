import { describe, it, expect } from 'vitest';
import { hashOtp, verifyOtpHash, constantTimeEqualHex } from '../../../src/lib/otpHashing.js';

describe('hashOtp', () => {
  it('throws TypeError for null OTP', () => {
    expect(() => hashOtp(null)).toThrow(TypeError);
  });

  it('throws TypeError for undefined OTP', () => {
    expect(() => hashOtp(undefined)).toThrow(TypeError);
  });

  it('throws TypeError for empty string OTP', () => {
    expect(() => hashOtp('')).toThrow(TypeError);
  });

  it('throws TypeError for whitespace-only OTP', () => {
    expect(() => hashOtp('   ')).toThrow(TypeError);
  });

  it('returns an object with hash and salt properties', () => {
    const result = hashOtp('123456');
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('salt');
    expect(typeof result.hash).toBe('string');
    expect(typeof result.salt).toBe('string');
  });

  it('returns a 128-character hex hash (scrypt 64 bytes)', () => {
    const { hash } = hashOtp('123456');
    expect(hash).toMatch(/^[a-f0-9]{128}$/);
  });

  it('returns a 32-character hex salt (16 bytes)', () => {
    const { salt } = hashOtp('123456');
    expect(salt).toMatch(/^[a-f0-9]{32}$/);
  });

  it('uses provided salt when given', () => {
    const { hash, salt } = hashOtp('123456', 'abcd1234abcd1234abcd1234abcd1234');
    expect(salt).toBe('abcd1234abcd1234abcd1234abcd1234');
    expect(hash).toMatch(/^[a-f0-9]{128}$/);
  });

  it('produces consistent hash for same OTP and salt', () => {
    const salt = 'abcd1234abcd1234abcd1234abcd1234';
    const hash1 = hashOtp('123456', salt);
    const hash2 = hashOtp('123456', salt);
    expect(hash1.hash).toBe(hash2.hash);
  });

  it('produces different hash for different OTPs with same salt', () => {
    const salt = 'abcd1234abcd1234abcd1234abcd1234';
    const hash1 = hashOtp('123456', salt);
    const hash2 = hashOtp('654321', salt);
    expect(hash1.hash).not.toBe(hash2.hash);
  });

  it('accepts numeric OTP input', () => {
    const result = hashOtp(123456);
    expect(result.hash).toMatch(/^[a-f0-9]{128}$/);
  });
});

describe('verifyOtpHash', () => {
  it('returns false when otpRecord is null', () => {
    expect(verifyOtpHash('123456', null)).toBe(false);
  });

  it('returns false when otpRecord is undefined', () => {
    expect(verifyOtpHash('123456', undefined)).toBe(false);
  });

  it('returns false for scrypt record with invalid hash format', () => {
    expect(verifyOtpHash('123456', { otp_hash: 'not-hex', otp_salt: 'abcd1234abcd1234abcd1234abcd1234' })).toBe(false);
  });

  it('returns false for pre-migration record with invalid hash format', () => {
    expect(verifyOtpHash('123456', { otp_hash: 'invalid' })).toBe(false);
  });

  it('returns false for non-matching OTP (scrypt record)', () => {
    const { hash, salt } = hashOtp('123456');
    expect(verifyOtpHash('654321', { otp_hash: hash, otp_salt: salt })).toBe(false);
  });

  it('returns true for matching OTP (scrypt record)', () => {
    const { hash, salt } = hashOtp('123456');
    expect(verifyOtpHash('123456', { otp_hash: hash, otp_salt: salt })).toBe(true);
  });

  it('returns true for matching OTP (pre-migration SHA-256 record)', async () => {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update('123456').digest('hex');
    expect(verifyOtpHash('123456', { otp_hash: hash })).toBe(true);
  });

  it('returns false for non-matching OTP (pre-migration record)', async () => {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update('123456').digest('hex');
    expect(verifyOtpHash('654321', { otp_hash: hash })).toBe(false);
  });

  it('returns false when record has no valid hash fields', () => {
    expect(verifyOtpHash('123456', {})).toBe(false);
    expect(verifyOtpHash('123456', { random: 'value' })).toBe(false);
  });
});

describe('constantTimeEqualHex', () => {
  it('returns false for non-string inputs', () => {
    expect(constantTimeEqualHex(null, 'abc')).toBe(false);
    expect(constantTimeEqualHex('abc', null)).toBe(false);
    expect(constantTimeEqualHex(123, 'abc')).toBe(false);
    expect(constantTimeEqualHex('abc', 123)).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(constantTimeEqualHex('abc', 'abcd')).toBe(false);
    expect(constantTimeEqualHex('abcd', 'abc')).toBe(false);
  });

  it('returns false for non-hex strings', () => {
    expect(constantTimeEqualHex('xyz123', 'xyz123')).toBe(false);
  });

  it('returns true for equal hex strings', () => {
    expect(constantTimeEqualHex('deadbeef', 'deadbeef')).toBe(true);
  });

  it('returns false for unequal hex strings of same length', () => {
    expect(constantTimeEqualHex('deadbeef', 'feedbeef')).toBe(false);
  });
});
