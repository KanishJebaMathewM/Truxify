/**
 * @fileoverview OTP Producer Service for Phone Number Verification.
 * Resolves Issue #10471: Implements the missing OTP generation and insertion
 * logic that was left incomplete in #9489.
 * 
 * Responsibilities:
 * 1. Generate cryptographically secure 6-digit OTPs
 * 2. Hash OTPs with a per-request salt (never store plaintext)
 * 3. Insert OTP record into phone_otps table with expiration
 * 4. Trigger SMS delivery via notification service
 * 5. Enforce rate limiting to prevent abuse
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * OTP configuration constants
 */
export const OTP_CONFIG = {
  LENGTH: 6,
  TTL_MINUTES: 10,
  MAX_ATTEMPTS_PER_PHONE: 5,
  RATE_LIMIT_WINDOW_MINUTES: 60,
  MAX_OTPS_PER_WINDOW: 3
};

/**
 * Generates a cryptographically secure random 6-digit OTP.
 * Uses crypto.randomInt for uniform distribution across 000000-999999.
 * 
 * @returns {string} 6-digit OTP string (zero-padded)
 */
export function generateOtp() {
  // Generate random integer between 0 and 999999 (inclusive)
  const otpNumber = crypto.randomInt(0, 1000000);
  // Zero-pad to ensure 6 digits (e.g., 42 -> "000042")
  return otpNumber.toString().padStart(OTP_CONFIG.LENGTH, '0');
}

/**
 * Generates a cryptographically secure random salt.
 * 
 * @param {number} length - Salt length in bytes (default: 16)
 * @returns {string} Hex-encoded salt string
 */
export function generateSalt(length = 16) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hashes an OTP with a salt using SHA-256.
 * This ensures plaintext OTPs are never stored in the database.
 * 
 * @param {string} otp - The plaintext OTP
 * @param {string} salt - The salt to use
 * @returns {string} Hex-encoded hash
 */
export function hashOtp(otp, salt) {
  if (!otp || !salt) {
    throw new Error('OTP and salt are required for hashing');
  }
  return crypto
    .createHash('sha256')
    .update(otp + salt)
    .digest('hex');
}

/**
 * Verifies an OTP against a stored hash and salt.
 * 
 * @param {string} providedOtp - The OTP provided by the user
 * @param {string} storedHash - The hash from the database
 * @param {string} storedSalt - The salt from the database
 * @returns {boolean} True if OTP matches
 */
export function verifyOtpHash(providedOtp, storedHash, storedSalt) {
  if (!providedOtp || !storedHash || !storedSalt) return false;
  const computedHash = hashOtp(providedOtp, storedSalt);
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}

/**
 * Checks rate limiting for OTP requests per phone number.
 * Prevents abuse by limiting OTP requests to MAX_OTPS_PER_WINDOW per RATE_LIMIT_WINDOW_MINUTES.
 * Counts all OTP creation attempts within the window regardless of active/verified status,
 * ensuring callers cannot bypass rate limits by requesting new OTPs.
 * 
 * @param {string} phone - Phone number in E.164 format
 * @returns {Promise<{allowed: boolean, retryAfter?: number, reason?: string}>}
 */
export async function checkOtpRateLimit(phone) {
  if (!supabaseAdmin) {
    logger.warn('supabaseAdmin not configured, allowing OTP request');
    return { allowed: true };
  }

  const windowStart = new Date(Date.now() - OTP_CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

  try {
    const { data, error } = await supabaseAdmin
      .from('phone_otps')
      .select('id, created_at')
      .eq('phone', phone)
      .gte('created_at', windowStart.toISOString());

    if (error) {
      logger.error({ err: error, phone }, 'Failed to check OTP rate limit');
      // Fail open to not block legitimate users
      return { allowed: true };
    }

    const count = data?.length || 0;

    if (count >= OTP_CONFIG.MAX_OTPS_PER_WINDOW) {
      const oldestInWindow = data[data.length - 1]?.created_at;
      const retryAfter = oldestInWindow 
        ? Math.ceil((new Date(oldestInWindow).getTime() + OTP_CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - Date.now()) / 1000)
        : OTP_CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60;

      return {
        allowed: false,
        retryAfter: Math.max(retryAfter, 60),
        reason: 'RATE_LIMIT_EXCEEDED'
      };
    }

    return { allowed: true };
  } catch (err) {
    logger.error({ err, phone }, 'Error checking OTP rate limit');
    return { allowed: true };
  }
}

/**
 * Generates, hashes, stores, and delivers an OTP for phone verification.
 * 
 * @param {string} phone - Phone number in E.164 format (+919999999999)
 * @param {object} options - Optional configuration
 * @param {string} options.channel - Delivery channel ('sms', 'voice')
 * @param {string} options.purpose - Purpose of OTP ('login', 'verify_phone', 'reset_password')
 * @returns {Promise<{success: boolean, otpId?: string, expiresAt?: string, error?: string}>}
 */
export async function requestOtp(phone, options = {}) {
  const { channel = 'sms', purpose = 'verify_phone' } = options;

  // Validate phone format (basic E.164 check)
  if (!phone || typeof phone !== 'string' || !phone.match(/^\+[1-9]\d{1,14}$/)) {
    return {
      success: false,
      error: 'INVALID_PHONE_FORMAT',
      message: 'Phone number must be in E.164 format (e.g., +919999999999)'
    };
  }

  // Check rate limit
  const rateCheck = await checkOtpRateLimit(phone);
  if (!rateCheck.allowed) {
    logger.warn({ phone, reason: rateCheck.reason }, 'OTP rate limit exceeded');
    return {
      success: false,
      error: rateCheck.reason,
      retryAfter: rateCheck.retryAfter,
      message: `Too many OTP requests. Try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`
    };
  }

  // Supersede any previously active OTPs for this phone before creating a new one.
  // Must be called before the insert so the new OTP itself is not caught by the filter.
  try {
    await invalidatePreviousOtps(phone);
  } catch (invalErr) {
    logger.error({ err: invalErr, phone }, 'Failed to invalidate prior OTPs before generating new one');
    return {
      success: false,
      error: 'DATABASE_ERROR',
      message: 'Failed to invalidate previous OTP'
    };
  }

  // Generate OTP and salt
  const plaintextOtp = generateOtp();
  const salt = generateSalt();
  const otpHash = hashOtp(plaintextOtp, salt);

  // Calculate expiration
  const expiresAt = new Date(Date.now() + OTP_CONFIG.TTL_MINUTES * 60 * 1000);

  if (!supabaseAdmin) {
    logger.error('supabaseAdmin not configured, cannot store OTP');
    return {
      success: false,
      error: 'SERVICE_UNAVAILABLE',
      message: 'OTP service is not configured'
    };
  }

  try {
    // Insert OTP record into phone_otps table.
    // is_active:true marks this as the current valid OTP for the phone.
    const { data, error } = await supabaseAdmin
      .from('phone_otps')
      .insert([{
        phone,
        otp_hash: otpHash,
        otp_salt: salt,
        expires_at: expiresAt.toISOString(),
        is_active: true,
        verified: false,
        verified_at: null,
        channel,
        purpose,
        attempts: 0,
        created_at: new Date().toISOString()
      }])
      .select('id')
      .single();

    if (error) {
      logger.error({ err: error, phone }, 'Failed to insert OTP record');
      return {
        success: false,
        error: 'DATABASE_ERROR',
        message: 'Failed to generate OTP'
      };
    }

    // Trigger SMS/voice delivery (fire-and-forget)
    deliverOtp(phone, plaintextOtp, channel).catch((err) => {
      logger.error({ err, phone, channel }, 'Failed to deliver OTP via notification service');
    });

    logger.info({ 
      phone: phone.replace(/(\+\d{2})\d+(\d{4})/, '$1***$2'), // Mask middle digits
      otpId: data.id,
      expiresAt: expiresAt.toISOString(),
      channel,
      purpose
    }, 'OTP generated and stored');

    return {
      success: true,
      otpId: data.id,
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: OTP_CONFIG.TTL_MINUTES
    };
  } catch (err) {
    logger.error({ err, phone }, 'Unexpected error in requestOtp');
    return {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    };
  }
}

/**
 * Delivers OTP via SMS or voice call.
 * This is a fire-and-forget operation - failures are logged but don't block the request.
 * 
 * @param {string} phone - Phone number
 * @param {string} otp - Plaintext OTP to deliver
 * @param {string} channel - 'sms' or 'voice'
 */
async function deliverOtp(phone, otp, channel) {
  // In production, this would call Twilio/MSG91/etc.
  // For now, log in development mode only
  if (process.env.NODE_ENV === 'development' || process.env.LOG_OTP_IN_DEV === 'true') {
    logger.info({
      phone: phone.replace(/(\+\d{2})\d+(\d{4})/, '$1***$2'),
      otp,
      channel
    }, `[DEV] OTP Delivery - Channel: ${channel.toUpperCase()}`);
  }

  // TODO: Integrate with actual SMS/Voice provider
  // Example with Twilio:
  // await twilioClient.messages.create({
  //   body: `Your Truxify verification code is: ${otp}`,
  //   to: phone,
  //   from: process.env.TWILIO_PHONE_NUMBER
  // });
}

/**
 * Deactivates all currently active OTPs for a phone number without touching
 * the `verified` column.
 *
 * Previously this function set `verified = true` to "cancel" superseded OTPs,
 * which corrupted the audit trail by making them indistinguishable from OTPs
 * the user actually verified (fixes #16055).
 *
 * The `verified` column is now reserved exclusively for OTPs that the user
 * successfully entered. Superseded OTPs are identified by:
 *   - `is_active = false`              — the OTP is no longer usable
 *   - `invalidated_reason = 'superseded'` — explains why it was deactivated
 *   - `invalidated_at`                 — timestamp when it was superseded
 *   - `verified` remains `false`       — the user never entered this OTP
 *
 * @param {string} phone - Phone number in E.164 format
 */
export async function invalidatePreviousOtps(phone) {
  if (!supabaseAdmin) return;

  try {
    const { error } = await supabaseAdmin
      .from('phone_otps')
      .update({
        is_active: false,
        invalidated_reason: 'superseded',
        invalidated_at: new Date().toISOString(),
      })
      .eq('phone', phone)
      .eq('is_active', true)
      .eq('verified', false);

    if (error) {
      logger.error({ err: error, phone }, 'Failed to invalidate previous OTPs');
      throw error;
    }
  } catch (err) {
    logger.error({ err, phone }, 'Failed to invalidate previous OTPs');
    throw err;
  }
}

/**
 * Marks an OTP as verified after successful verification and deactivates it
 * so it cannot be reused.
 * 
 * @param {string} otpId - The OTP record ID
 */
export async function markOtpVerified(otpId) {
  if (!supabaseAdmin || !otpId) return;

  try {
    await supabaseAdmin
      .from('phone_otps')
      .update({ 
        verified: true, 
        verified_at: new Date().toISOString(),
        // Deactivate after successful use — a verified OTP must not be reusable.
        is_active: false,
      })
      .eq('id', otpId);
  } catch (err) {
    logger.error({ err, otpId }, 'Failed to mark OTP as verified');
  }
}

/**
 * Increments the attempt counter for an OTP record.
 * Used to lock out after MAX_ATTEMPTS_PER_PHONE failed verifications.
 * 
 * @param {string} otpId - The OTP record ID
 * @returns {Promise<number>} New attempt count
 */
export async function incrementOtpAttempts(otpId) {
  if (!supabaseAdmin || !otpId) return 0;

  try {
    const { data, error } = await supabaseAdmin
      .from('phone_otps')
      .update({ attempts: supabaseAdmin.rpc ? 'attempts + 1' : 1 })
      .eq('id', otpId)
      .select('attempts')
      .single();

    if (error) {
      logger.error({ err: error, otpId }, 'Failed to increment OTP attempts');
      return 0;
    }

    return data?.attempts || 0;
  } catch (err) {
    logger.error({ err, otpId }, 'Error incrementing OTP attempts');
    return 0;
  }
}

/**
 * Cleans up expired OTPs older than the retention period.
 * Should be called periodically by a background worker.
 * 
 * @param {number} retentionDays - Days to retain expired OTPs (default: 30)
 */
export async function cleanupExpiredOtps(retentionDays = 30) {
  if (!supabaseAdmin) return;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  try {
    const { error } = await supabaseAdmin
      .from('phone_otps')
      .delete()
      .lt('expires_at', cutoff.toISOString());

    if (error) {
      logger.error({ err: error }, 'Failed to cleanup expired OTPs');
    }
  } catch (err) {
    logger.error({ err }, 'Error during OTP cleanup');
  }
}
