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
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(otp), salt, 64);
  return { hash: key.toString('hex'), salt };
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


// === Spec 12: constant-time hex compare ===
export function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Reject non-hex input before any comparison to preserve the timing
  // guarantee for valid inputs.  Buffer.from with hex encoding silently
  // truncates at the first invalid char, so we validate upfront.
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;
  // Pad the shorter string with null bytes so both buffers are the same length.
  // This keeps the crypto.timingSafeEqual call constant-time regardless of
  // whether the inputs differ in length.
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.from(a.padEnd(maxLen, '\0'), 'ascii');
  const bufB = Buffer.from(b.padEnd(maxLen, '\0'), 'ascii');
  try { return crypto.timingSafeEqual(bufA, bufB) && a.length === b.length; }
  catch (_) { return false; }
}
