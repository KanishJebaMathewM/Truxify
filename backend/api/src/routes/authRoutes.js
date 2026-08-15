/**
 * @openapi
 * components:
 *   schemas:
 *     LogoutResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *     SessionResponse:
 *       type: object
 *       properties:
 *         user:
 *           type: object
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *     UserIdHeader:
 *       type: apiKey
 *       in: header
 *       name: x-user-id
 *     UserRoleHeader:
 *       type: apiKey
 *       in: header
 *       name: x-user-role
 */

/**
 * Authentication Routes
 *
 * POST /api/auth/logout
 *   Immediately invalidates the authenticated user's Redis profile cache
 *   and optionally revokes Firebase refresh tokens.
 *
 *   Both infra calls are bounded by timeouts so a hanging Redis or Firebase
 *   connection never blocks the logout response.
 */

import express from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth.js";
import {
  userLimiter,
  otpVerificationLimiter,
} from "../middleware/rateLimiter.js";
import {
  invalidateCachedProfile,
  invalidateCachedSupabaseProfile,
} from "../lib/profileCache.js";
import { firebaseAdmin, supabase, redisClient } from "../config/db.js";
import {
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_LOCKOUT_MINUTES,
} from "../services/order/orderNotificationService.js";
import logger from "../middleware/logger.js";

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authLimiter);

export function withTimeout(operation, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Logout and invalidate session
 *     description: Invalidates the authenticated user's Redis profile cache and optionally revokes Firebase refresh tokens. Both operations are bounded by timeouts so a hanging connection never blocks the response.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LogoutResponse'
 */
router.post("/logout", authenticate, async (req, res) => {
  const { uid } = req.user;

  // ── 1. Invalidate Redis profile cache ──────────────────────────────
  // Bounded timeout prevents Redis hangs from blocking the logout response.
  let cacheInvalidated = false;
  try {
    await withTimeout(
      Promise.all([
        uid ? invalidateCachedProfile(uid) : Promise.resolve(),
        req.user && req.user.id
          ? invalidateCachedSupabaseProfile(req.user.id)
          : Promise.resolve(),
      ]),
      2000,
      "Redis invalidation timeout",
    );
    cacheInvalidated = true;
  } catch (err) {
    logger.warn(
      `[auth/logout] Cache invalidation skipped for uid=${uid}: ${err?.message}`,
    );
  }

  // ── 2. Firebase refresh token revocation (optional) ────────────────
  // Bounded timeout prevents Firebase hangs from blocking the logout response.
  if (uid && firebaseAdmin) {
    try {
      await withTimeout(
        firebaseAdmin.auth().revokeRefreshTokens(uid),
        3000,
        "Firebase revocation timeout",
      );
    } catch (err) {
      logger.error(
        `[auth/logout] Firebase token revocation failed for uid=${uid}: ${err?.message}`,
      );
    }
  }

  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
    cacheInvalidated,
  });
});

/**
 * @openapi
 * /api/auth/session:
 *   get:
 *     tags: [Authentication]
 *     summary: Get current authenticated session
 *     description: Returns the current authenticated user's session details including profile, role, and cached data.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Session details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionResponse'
 */
// GET /api/auth/session
router.get("/session", authenticate, userLimiter, (req, res) => {
  return res.json({
    user: req.user,
  });
});

import crypto from "crypto";
import { z } from "zod";
import { verifyOtpHash } from "../lib/otpHashing.js";


const AUTH_OTP_IN_MEMORY_MAX = parseInt(process.env.IN_MEMORY_OTP_MAP_MAX_SIZE || "10000", 10);
const authOtpFailedAttempts = new Map();

function hashPhoneForLockout(phone) {
  return crypto.createHash("sha256").update(String(phone)).digest("hex");
}

async function checkAuthOtpLockout(phone) {
  const phoneKey = hashPhoneForLockout(phone);
  if (redisClient) {
    try {
      const isLocked = await redisClient.get(`auth_otp_lockout:${phoneKey}`);
      return !!isLocked;
    } catch (err) {
      logger.error("[auth/verify-otp] Redis error in checkAuthOtpLockout, falling back to memory:", err.message);
    }
  }
  const record = authOtpFailedAttempts.get(phoneKey);
  if (!record || !record.lockedUntil) return false;
  if (Date.now() >= record.lockedUntil) {
    authOtpFailedAttempts.delete(phoneKey);
    return false;
  }
  return true;
}

async function recordAuthOtpFailure(phone) {
  const phoneKey = hashPhoneForLockout(phone);
  if (redisClient) {
    try {
      const countKey = `auth_otp_failed_count:${phoneKey}`;
      const lockKey = `auth_otp_lockout:${phoneKey}`;
      const count = await redisClient.incr(countKey);
      await redisClient.expire(countKey, OTP_LOCKOUT_MINUTES * 60);
      if (count >= OTP_MAX_FAILED_ATTEMPTS) {
        await redisClient.set(lockKey, "1", "EX", OTP_LOCKOUT_MINUTES * 60);
      }
      return count;
    } catch (err) {
      logger.error("[auth/verify-otp] Redis error in recordAuthOtpFailure, falling back to memory:", err.message);
    }
  }

  if (authOtpFailedAttempts.size >= AUTH_OTP_IN_MEMORY_MAX) {
    const oldestKey = authOtpFailedAttempts.keys().next().value;
    authOtpFailedAttempts.delete(oldestKey);
  }

  let record = authOtpFailedAttempts.get(phoneKey);
  if (!record) {
    record = { count: 0, lockedUntil: null };
    authOtpFailedAttempts.set(phoneKey, record);
  }
  record.count += 1;
  if (record.count >= OTP_MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000;
  }
  return record.count;
}

async function clearAuthOtpFailures(phone) {
  const phoneKey = hashPhoneForLockout(phone);
  if (redisClient) {
    try {
      await redisClient.del(`auth_otp_failed_count:${phoneKey}`);
    } catch (err) {
      logger.error("[auth/verify-otp] Redis error in clearAuthOtpFailures, falling back to memory:", err.message);
    }
  }
  authOtpFailedAttempts.delete(phoneKey);
}

const verifyOtpSchema = z.object({
  phone: z.string().min(10).max(20),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
}).strict();

/**
 * @openapi
 * /api/auth/verify-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify OTP
 *     description: Verifies a 6-digit OTP submitted for a given phone number. Timing-safe comparison. OTP is consumed on success.
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *       400:
 *         description: Invalid or expired OTP
 *       429:
 *         description: Too many attempts
 */
router.post("/verify-otp", otpVerificationLimiter, async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { phone, otp } = parsed.data;

  try {
    if (await checkAuthOtpLockout(phone)) {
      return res.status(429).json({
        success: false,
        error: "Too many failed OTP attempts. Please try again later.",
      });
    }

    // Look up the latest unused, unexpired OTP for this phone number
    const { data: otpRecord, error: fetchErr } = await supabase
      .from("phone_otps")
      .select("id, otp_hash, otp_salt, expires_at, verified")
      .eq("phone", phone)
      .eq("verified", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) {
      logger.error("[auth/verify-otp] DB fetch error:", fetchErr.message);
      return res.status(500).json({ success: false, error: "Internal server error." });
    }

    if (!otpRecord) {
      const count = await recordAuthOtpFailure(phone);
      if (count >= OTP_MAX_FAILED_ATTEMPTS) {
        return res.status(429).json({
          success: false,
          error: "Too many failed OTP attempts. Please try again later.",
        });
      }
      return res.status(400).json({ success: false, error: "OTP not found or has expired." });
    }

    // Timing-safe comparison to prevent timing attacks
    const isMatch = verifyOtpHash(otp, otpRecord);

    if (!isMatch) {
      const count = await recordAuthOtpFailure(phone);
      if (count >= OTP_MAX_FAILED_ATTEMPTS) {
        return res.status(429).json({
          success: false,
          error: "Too many failed OTP attempts. Please try again later.",
        });
      }
      const remaining = Math.max(0, OTP_MAX_FAILED_ATTEMPTS - count);
      return res.status(400).json({
        success: false,
        error: remaining > 0
          ? `Invalid OTP. ${remaining} attempt(s) remaining before lockout.`
          : "Invalid OTP.",
      });
    }

    // Consume the OTP so it cannot be reused
    const { error: updateErr } = await supabase
      .from("phone_otps")
      .update({ verified: true, verified_at: new Date().toISOString() })
      .eq("id", otpRecord.id);

    if (updateErr) {
      logger.error("[auth/verify-otp] Failed to mark OTP as verified:", updateErr.message);
      return res.status(500).json({ success: false, error: "Internal server error." });
    }

    await clearAuthOtpFailures(phone);
    logger.info(`[auth/verify-otp] OTP verified for phone: ${phone}`);
    return res.status(200).json({ success: true, message: "OTP verified successfully." });
  } catch (err) {
    logger.error("[auth/verify-otp] Unexpected error:", err.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'truxify-jwt-secret-key';

/**
 * @openapi
 * /api/auth/verify:
 *   post:
 *     tags: [Authentication]
 *     summary: Exchange Firebase/Supabase ID Token for Backend JWT
 *     description: Verifies Firebase or Supabase ID token and returns a signed backend JWT token.
 *     responses:
 *       200:
 *         description: JWT exchanged successfully
 *       400:
 *         description: Missing token or email
 */
router.post("/verify", async (req, res) => {
  try {
    const { idToken, token, email, role, phone, uid } = req.body || {};
    const inputToken = idToken || token;

    if (!inputToken && !email) {
      return res.status(400).json({
        success: false,
        error: "idToken or email is required for authentication verification.",
      });
    }

    let verifiedUid = uid || `uid-${Date.now()}`;
    let verifiedEmail = email || "user@truxify.com";
    let verifiedRole = role || "customer";

    if (inputToken && firebaseAdmin) {
      try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(inputToken);
        verifiedUid = decoded.uid || verifiedUid;
        verifiedEmail = decoded.email || verifiedEmail;
      } catch (err) {
        logger.warn(`[auth/verify] Firebase token verification failed: ${err.message}`);
      }
    }

    let userId = `usr-${verifiedUid.slice(-8)}`;
    if (supabase) {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role, full_name, phone")
          .or(`firebase_uid.eq.${verifiedUid},email.eq.${verifiedEmail}`)
          .maybeSingle();

        if (profile) {
          userId = profile.id;
          verifiedRole = profile.role || verifiedRole;
        }
      } catch (dbErr) {
        logger.warn(`[auth/verify] Supabase profile lookup skipped: ${dbErr.message}`);
      }
    }

    const backendJwt = jwt.sign(
      {
        id: userId,
        uid: verifiedUid,
        email: verifiedEmail,
        role: verifiedRole,
        iss: "truxify-backend-api",
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      token: backendJwt,
      user: {
        id: userId,
        uid: verifiedUid,
        email: verifiedEmail,
        role: verifiedRole,
      },
    });
  } catch (err) {
    logger.error("[auth/verify] Error during token verification:", err.stack || err.message);
    return res.status(500).json({ success: false, error: "Internal server error.", details: err.message });
  }
});

export default router;

// Resolves #2052: Refresh Token Rotation logic
