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

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
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
