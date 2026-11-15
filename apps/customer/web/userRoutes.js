
/**
 * @fileoverview userRoutes.js
 *
 * Handles user-specific endpoints, including updating Firebase
 * Cloud Messaging (FCM) tokens for authenticated users.
 */

import express from 'express';
import { createUserClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { deviceLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { z } from 'zod';

const router = express.Router();

// Validation schema
// Do not use a restrictive regex: valid FCM tokens may contain
// characters such as /, =, +, ., and %.
const fcmTokenSchema = z.object({
  fcmToken: z
    .string({ required_error: 'fcmToken is required' })
    .min(10, 'fcmToken must be at least 10 characters')
    .max(4096, 'fcmToken must be at most 4096 characters'),
});

// POST /api/users/fcm-token
router.post(
  '/fcm-token',
  authenticate,
  deviceLimiter,
  validateBody(fcmTokenSchema),
  async (req, res) => {
    const userId = req.user?.id;
    const { fcmToken } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required.' });
    }

    try {
      // Update using the authenticated user's client.
      const { data, error } = await createUserClient(req.token)
        .from('profiles')
        .update({
          fcm_token: fcmToken,
          fcm_token_updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('id');

      if (error) {
        logger.error(
          '[UserRoutes] Failed to update FCM token in profiles:',
          error.message
        );
        return res.status(500).json({
          error: 'Failed to update FCM token.',
        });
      }

      // Ensure a profile row was actually updated.
      if (!data || data.length === 0) {
        logger.error(
          `[UserRoutes] No profile row matched for user ${userId}; FCM token not persisted.`
        );
        return res.status(500).json({
          error: 'Failed to update FCM token.',
        });
      }

      logger.info(`[UserRoutes] FCM token updated for user ${userId}`);

      return res.json({
        success: true,
        message: 'FCM token updated.',
      });
    } catch (err) {
      logger.error(
        '[UserRoutes] Unexpected error updating FCM token:',
        err.message
      );
      return res.status(500).json({
        error: 'Internal server error.',
      });
    }
  }
);

export default router;
