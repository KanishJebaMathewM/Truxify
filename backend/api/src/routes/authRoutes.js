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

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { invalidateCachedProfile, invalidateCachedSupabaseProfile } from '../lib/profileCache.js';
import { firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

const router = express.Router();

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
 * POST /api/auth/logout
 * Requires: Bearer token (Firebase or Supabase)
 * Response: { success: true, message: 'Logged out successfully' }
 */
router.post('/logout', authenticate, async (req, res) => {
  const { uid } = req.user;

  // ── 1. Invalidate Redis profile cache ──────────────────────────────
  // Bounded timeout prevents Redis hangs from blocking the logout response.
  try {
    await withTimeout(
      Promise.all([
        uid ? invalidateCachedProfile(uid) : Promise.resolve(),
        req.user && req.user.id ? invalidateCachedSupabaseProfile(req.user.id) : Promise.resolve(),
      ]),
      2000,
      'Redis invalidation timeout'
    );
  } catch (err) {
    logger.warn(`[auth/logout] Cache invalidation skipped for uid=${uid}: ${err?.message}`);
  }

  // ── 2. Firebase refresh token revocation (optional) ────────────────
  // Bounded timeout prevents Firebase hangs from blocking the logout response.
  if (uid && firebaseAdmin) {
    try {
      await withTimeout(
        firebaseAdmin.auth().revokeRefreshTokens(uid),
        3000,
        'Firebase revocation timeout'
      );
    } catch (err) {
      logger.error(`[auth/logout] Firebase token revocation failed for uid=${uid}: ${err?.message}`);
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * @openapi
 * /api/auth/session:
 *   get:
 *     summary: Retrieve current authenticated session user details
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current session user
 */
// GET /api/auth/session
router.get('/session', authenticate, userLimiter, (req, res) => {
  return res.json({
    user: req.user
  });
});

export default router;

// Resolves #2052: Refresh Token Rotation logic
