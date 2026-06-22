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
import { invalidateCachedProfile } from '../lib/profileCache.js';
import { firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

const router = express.Router();

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
    await Promise.race([
      invalidateCachedProfile(uid),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis invalidation timeout')), 2000)
      ),
    ]);
  } catch (err) {
    logger.warn({ uid, err: err?.message }, 'Cache invalidation skipped');
  }

  // ── 2. Firebase refresh token revocation (optional) ────────────────
  // Bounded timeout prevents Firebase hangs from blocking the logout response.
  if (uid && firebaseAdmin) {
    try {
      await Promise.race([
        firebaseAdmin.auth().revokeRefreshTokens(uid),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Firebase revocation timeout')), 3000)
        ),
      ]);
    } catch (err) {
      logger.error({ uid, err: err?.message }, 'Firebase token revocation failed');
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

export default router;
