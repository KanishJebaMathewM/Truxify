
/**
 * @fileoverview userRoutes.js
 *
 * This module handles user-specific endpoints that do not fit other route modules.
 *
 * PRIMARY ENDPOINT: POST /api/users/fcm-token
 *   Updates the Firebase Cloud Messaging (FCM) push token for the authenticated user.
 *   This endpoint is kept separate from deviceRoutes.js to maintain clear authorization
 *   scoping: the FCM token is a user-profile attribute (users own their notification
 *   tokens), while deviceRoutes.js handles device-level registration (platform,
 *   model, OS version). Splitting them prevents device operations from needing
 *   user-level write access to profiles.
 *
 * @module routes/userRoutes
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     FcmTokenUpdateRequest:
 *       type: object
 *       required:
 *         - fcmToken
 *       properties:
 *         fcmToken:
 *           type: string
 *           description: Firebase Cloud Messaging device token (10–4096 chars, alphanumeric + -_:)
 */

import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { deviceLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { z } from 'zod';

const router = express.Router();

// ── Validation schema ──────────────────────────────────────────────────────
const fcmTokenSchema = z.object({
  fcmToken: z
    .string({ required_error: 'fcmToken is required' })
    .min(10, 'fcmToken must be at least 10 characters')
    .max(4096, 'fcmToken must be at most 4096 characters'),
});

// ============================================================================
// POST /api/users/fcm-token — update FCM token for the authenticated user
// ============================================================================

/**
 * @fileoverview userRoutes.js
 *
 * This module handles user-specific endpoints that do not fit other route modules.
 *
 * PRIMARY ENDPOINT: POST /api/users/fcm-token
 *   Updates the Firebase Cloud Messaging (FCM) push token for the authenticated user.
 *   This endpoint is kept separate from deviceRoutes.js to maintain clear authorization
 *   scoping: the FCM token is a user-profile attribute (users own their notification
 *   tokens), while deviceRoutes.js handles device-level registration (platform,
 *   model, OS version). Splitting them prevents device operations from needing
 *   user-level write access to profiles.
 *
 * @module routes/userRoutes
 */

/**
 * @openapi
 * /api/users/fcm-token:
 *   post:
 *     tags: [Users]
 *     summary: Update FCM push notification token
 *     description: >
 *       Stores or refreshes the Firebase Cloud Messaging token for the currently
 *       authenticated user's profile so they receive push notifications.
 *       The token is also mirrored from the profiles table that notification
 *       services query directly. Prefer /api/devices/register when you also need
 *       to record the device platform or metadata.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FcmTokenUpdateRequest'
 *     responses:
 *       200:
 *         description: FCM token updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error (missing or malformed token)
 *       401:
 *         description: Unauthenticated
 *       429:
 *         description: Rate limited
 *       500:
 *         description: Internal server error
 */
router.post(
  '/fcm-token',
  authenticate,
  deviceLimiter,
  validateBody(fcmTokenSchema),
  async (req, res) => {
    const userId = req.user?.id;
    const { fcmToken } = req.body;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          fcm_token: fcmToken,
          fcm_token_updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        logger.error('[UserRoutes] Failed to update FCM token in profiles:', error.message);
        return res.status(500).json({ error: 'Failed to update FCM token.' });
      }

      logger.info(`[UserRoutes] FCM token updated for user ${userId}`);
      return res.json({ success: true, message: 'FCM token updated.' });
    } catch (err) {
      logger.error('[UserRoutes] Unexpected error updating FCM token:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

export default router;
