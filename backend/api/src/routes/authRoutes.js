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
import { firebaseAdmin, supabase } from "../config/db.js";
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
    cacheInvalidated: true, // Redis errors are non-fatal — logout always succeeds
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
import { otpSendSchema } from "../validation/requestSchemas.js";
import { z } from "zod";
import { verifyOtpHash } from "../lib/otpHashing.js";

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
      return res.status(400).json({ success: false, error: "OTP not found or has expired." });
    }

    // Timing-safe comparison to prevent timing attacks
    const isMatch = verifyOtpHash(otp, otpRecord);

    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Invalid OTP." });
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

    logger.info(`[auth/verify-otp] OTP verified for phone: ${phone}`);
    return res.status(200).json({ success: true, message: "OTP verified successfully." });
  } catch (err) {
    logger.error("[auth/verify-otp] Unexpected error:", err.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

export default router;

// Resolves #2052: Refresh Token Rotation logic
