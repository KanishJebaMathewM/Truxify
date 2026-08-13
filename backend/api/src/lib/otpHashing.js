import crypto from 'crypto';

/**
 * Hash an OTP with scrypt and a per-OTP random salt. The salt is
 * stored alongside the digest, so the stored value cannot be brute-forced
 * offline the way an unsalted SHA-256 of a 6-digit code can be.
 *
 * @param {string|number} otp
 * @param {string} [saltHex] - existing salt (for verification), or undefined
 *   to generate a fresh 16-byte salt.
 * @returns {{hash: string, salt: string}} hex-encoded scrypt digest (64 bytes)
 *   and hex-encoded salt.
 */
export function hashOtp(otp, saltHex) {
  if (otp === null || otp === undefined || (typeof otp === 'string' && otp.trim() === '')) {
    throw new TypeError('OTP must be a non-empty value');
  }
  let salt = saltHex;
  if (salt === undefined || salt === null) {
    salt = crypto.randomBytes(16).toString('hex');
  } else if (typeof salt !== 'string' || !/^[a-f0-9]{32}$/i.test(salt)) {
    // A supplied salt must be the hex encoding of exactly 16 bytes. Anything
    // else would either make scrypt throw a cryptic error or (worse) silently
    // weaken the KDF with a tiny salt.
    throw new TypeError('saltHex must be a 32-character hex string (16 bytes)');
  }
  const key = crypto.scryptSync(String(otp), salt, 64);
  return { hash: key.toString('hex'), salt: salt.toLowerCase() };
}

/**
 * Timing-safe comparison of a submitted OTP against a stored record.
 *
 * Records written after the salted-hash migration carry an `otp_salt`; those
 * are compared with scrypt. Pre-migration rows (no salt) are compared with
 * SHA-256 so in-flight OTPs keep working for their remaining TTL window.
 *
 * @param {string|number} otp
 * @param {{otp_hash?: string, otp_salt?: string}|null} otpRecord
 * @returns {boolean}
 */
export function verifyOtpHash(otp, otpRecord) {
  if (!otpRecord) return false;
  if (otpRecord.otp_salt) {
    // A malformed stored salt must fail verification cleanly (false), not
    // throw from scrypt.
    if (typeof otpRecord.otp_salt !== 'string' || !/^[a-f0-9]{32}$/i.test(otpRecord.otp_salt)) {
      return false;
    }
    const { hash: submittedHash } = hashOtp(otp, otpRecord.otp_salt);
    const expected = String(otpRecord.otp_hash || '');
    if (!/^[a-f0-9]{128}$/.test(expected)) return false;
    return crypto.timingSafeEqual(Buffer.from(submittedHash, 'hex'), Buffer.from(expected, 'hex'));
  }
  if (otpRecord.otp_hash && /^[a-f0-9]{64}$/.test(otpRecord.otp_hash)) {
    const submittedHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(submittedHash, 'hex'), Buffer.from(otpRecord.otp_hash, 'hex'));
  }
  return false;
}

export function generateOtpSecret(length = 6) {
  const len = Math.max(4, Math.min(10, Number(length) || 6));
  const min = Math.pow(10, len - 1);
  const max = Math.pow(10, len) - 1;
  return String(crypto.randomInt(min, max + 1));
}

