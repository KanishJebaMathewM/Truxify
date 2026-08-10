import { hashOtp, verifyOtpHash } from '../../src/lib/otpHashing.js';
import crypto from 'crypto';

describe('otpHashing', () => {
  describe('hashOtp', () => {
    it('generates different hashes and salts for the same OTP', () => {
      const otp = '123456';
      const result1 = hashOtp(otp);
      const result2 = hashOtp(otp);

      expect(result1.hash).toBeDefined();
      expect(result1.salt).toBeDefined();
      expect(result2.hash).toBeDefined();
      expect(result2.salt).toBeDefined();

      expect(result1.salt).not.toBe(result2.salt);
      expect(result1.hash).not.toBe(result2.hash);
    });

    it('generates the same hash if the same salt is provided', () => {
      const otp = '123456';
      const result1 = hashOtp(otp);
      const result2 = hashOtp(otp, result1.salt);

      expect(result2.salt).toBe(result1.salt);
      expect(result2.hash).toBe(result1.hash);
    });
  });

  describe('verifyOtpHash', () => {
    it('verifies a scrypt hashed OTP successfully', () => {
      const otp = '123456';
      const { hash, salt } = hashOtp(otp);
      
      const otpRecord = {
        otp_hash: hash,
        otp_salt: salt
      };

      expect(verifyOtpHash(otp, otpRecord)).toBe(true);
    });

    it('fails verification for an incorrect scrypt hashed OTP', () => {
      const otp = '123456';
      const wrongOtp = '654321';
      const { hash, salt } = hashOtp(otp);
      
      const otpRecord = {
        otp_hash: hash,
        otp_salt: salt
      };

      expect(verifyOtpHash(wrongOtp, otpRecord)).toBe(false);
    });

    it('verifies a legacy SHA-256 hashed OTP successfully (fallback)', () => {
      const otp = '123456';
      const legacyHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
      
      const otpRecord = {
        otp_hash: legacyHash,
        otp_salt: null // No salt for legacy
      };

      expect(verifyOtpHash(otp, otpRecord)).toBe(true);
    });

    it('fails verification for an incorrect legacy SHA-256 hashed OTP', () => {
      const otp = '123456';
      const wrongOtp = '654321';
      const legacyHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
      
      const otpRecord = {
        otp_hash: legacyHash,
        otp_salt: null
      };

      expect(verifyOtpHash(wrongOtp, otpRecord)).toBe(false);
    });

    it('returns false if otpRecord is null', () => {
      expect(verifyOtpHash('123456', null)).toBe(false);
    });

    it('returns false if stored scrypt hash format is invalid', () => {
      const otp = '123456';
      const otpRecord = {
        otp_hash: 'invalidhash',
        otp_salt: 'somesalt'
      };

      expect(verifyOtpHash(otp, otpRecord)).toBe(false);
    });

    it('returns false if stored SHA-256 hash format is invalid', () => {
      const otp = '123456';
      const otpRecord = {
        otp_hash: 'invalidhash',
        otp_salt: null
      };

      expect(verifyOtpHash(otp, otpRecord)).toBe(false);
    });
  });
});
