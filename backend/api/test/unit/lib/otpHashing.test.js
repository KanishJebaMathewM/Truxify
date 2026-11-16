import crypto from 'crypto';

/**
 * Generates a secure scrypt hash and salt for an OTP.
 * @param {string|number} otp - The plain-text OTP code.
 * @param {string} [providedSalt] - Optional predefined salt in hex.
 * @returns {{ hash: string, salt: string }} The derived hash and salt.
 */
export function hashOtp(otp, providedSalt) {
  if (otp === null || otp === undefined) {
    throw new TypeError('OTP cannot be null or undefined');
  }
  const strOtp = String(otp);
  if (strOtp.trim() === '') {
    throw new TypeError('OTP cannot be empty or whitespace-only');
  }

  const salt = providedSalt || crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(strOtp, salt, 64);
  
  return {
    hash: derivedKey.toString('hex'),
    salt,
  };
}

/**
 * Compares two hex strings in constant time to prevent timing attacks.
 * @param {string} a - First hex string.
 * @param {string} b - Second hex string.
 * @returns {boolean} True if they match, false otherwise.
 */
export function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  const hexRegex = /^[a-fA-F0-9]+$/;
  if (!hexRegex.test(a) || !hexRegex.test(b)) {
    return false;
  }

  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Verifies an OTP against a stored record (supporting scrypt or legacy SHA-256 hashes).
 * @param {string|number} otp - The plain-text OTP code to verify.
 * @param {Object} otpRecord - The stored database record containing otp_hash and optional otp_salt.
 * @returns {boolean} True if valid, false otherwise.
 */
export function verifyOtpHash(otp, otpRecord) {
  if (!otpRecord) {
    return false;
  }
  if (otp === null || otp === undefined) {
    return false;
  }
  const strOtp = String(otp);
  if (strOtp.trim() === '') {
    return false;
  }

  // Modern Scrypt Record (has both hash and salt)
  if (otpRecord.otp_hash && otpRecord.otp_salt) {
    try {
      const { hash } = hashOtp(strOtp, otpRecord.otp_salt);
      return constantTimeEqualHex(hash, otpRecord.otp_hash);
    } catch {
      return false;
    }
  }

  // Pre-migration SHA-256 Record (has hash only)
  if (otpRecord.otp_hash && !otpRecord.otp_salt) {
    try {
      const shaHash = crypto.createHash('sha256').update(strOtp).digest('hex');
      return constantTimeEqualHex(shaHash, otpRecord.otp_hash);
    } catch {
      return false;
    }
  }

  return false;
}
