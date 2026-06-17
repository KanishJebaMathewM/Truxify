import { supabase, firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * Fetch a user's FCM token from the profiles table.
 *
 * @param {string} userId - The user's profile UUID.
 * @returns {Promise<string|null>} The FCM token, or null if not set.
 */
async function getUserFcmToken(userId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('fcm_token')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.fcm_token) return null;
    return data.fcm_token;
  } catch (err) {
    logger.error(`[NotificationService] Failed to fetch FCM token: ${err.message}`);
    return null;
  }
}

/**
 * Send a push notification via Firebase Cloud Messaging.
 * Gracefully handles missing tokens, expired tokens, and Firebase errors.
 * FCM delivery failure never throws — it is always logged and swallowed.
 *
 * @param {string} userId - The recipient's profile UUID.
 * @param {object} notification - { title, body }
 * @param {object} [data={}] - Optional key-value data payload.
 */
export async function sendFcmNotification(userId, notification, data = {}) {
  if (!firebaseAdmin || !firebaseAdmin.messaging) {
    logger.warn('[FCM] Firebase not configured — skipping push notification');
    return;
  }

  const fcmToken = await getUserFcmToken(userId);
  if (!fcmToken) {
    logger.warn(`[FCM] No FCM token for user ${userId} — skipping push notification`);
    return;
  }

  try {
    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const messageId = await firebaseAdmin.messaging().send({
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: stringData,
    });

    logger.info(`[FCM] Push notification sent to user ${userId} — messageId: ${messageId}`);
  } catch (err) {
    // Log the failure but never propagate — FCM errors must not block HTTP responses
    logger.error(
      `[FCM] Delivery failed for user ${userId} — errorCode: ${err.code ?? 'unknown'} — ${err.message}`
    );

    // Clear permanently invalid/expired tokens (CodeRabbit feedback)
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      logger.warn(`[FCM] Clearing invalid FCM token for user ${userId} due to error: ${err.code}`);
      if (supabase) {
        try {
          await supabase
            .from('profiles')
            .update({
              fcm_token: null,
              fcm_token_updated_at: new Date().toISOString(),
            })
            .eq('id', userId);
        } catch (dbErr) {
          logger.error(`[FCM] Failed to clear invalid FCM token for user ${userId}: ${dbErr.message}`);
        }
      }
    }
  }
}

/**
 * Deliver the delivery OTP to the customer through a secure out-of-band channel.
 *
 * @param {string} customerId - The customer's profile UUID.
 * @param {string} orderDisplayId - The display identifier of the order (e.g. #FFYYYYMMDDXXXX).
 * @param {string} otp - The 6-digit delivery OTP.
 */
export async function sendDeliveryOtpNotification(customerId, orderDisplayId, otp) {
  logger.info(
    `[NotificationService] Delivering OTP for Order ${orderDisplayId} to Customer ${customerId}`
  );

  const title = 'Delivery Verification OTP';
  const body  = `Your delivery OTP for order ${orderDisplayId} is ${otp}. Share this with the driver only after verifying your cargo has arrived safely.`;

  // 1. Database Notification Persistence (always attempted first)
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: customerId,
        title,
        body,
        notif_type: 'order_update',
        metadata: { order_display_id: orderDisplayId },
      });

    if (error) {
      logger.error('[NotificationService] Database insert failed:', error);
    } else {
      logger.info('[NotificationService] Notification inserted successfully');
    }
  } catch (dbErr) {
    logger.error(
      '[NotificationService] Database connection error during notification insert:',
      dbErr.message
    );
  }

  // 2. FCM Push Notification (fire-and-forget — never blocks the caller)
  // Secure: Do not include raw OTP values in push notification text (CodeRabbit feedback)
  void sendFcmNotification(
    customerId,
    {
      title: 'Delivery Verification OTP',
      body: `A delivery OTP has been generated for order ${orderDisplayId}. Open the app to view the code.`
    },
    { orderDisplayId, notifType: 'delivery_otp' }
  );

  // 3. SMS Gateway (e.g. Twilio) Stub
  if (process.env.TWILIO_AUTH_TOKEN) {
    const smsOtpLog = process.env.NODE_DEBUG
      ? `Sending SMS to customer phone containing OTP ${otp}`
      : `Sending SMS to customer phone containing OTP ${otp.slice(0, 2)}***`;
    logger.info(`[NotificationService] [SMS] SMS stub: ${smsOtpLog}`);
  } else {
    const logOtp = process.env.NODE_DEBUG ? otp : `${otp.slice(0, 2)}***`;
    logger.info(
      `[NotificationService] [SMS] SMS stub: No SMS gateway configured. Logging OTP out-of-band: ${logOtp}`
    );
  }
}

/**
 * Send a generic push notification to any user.
 * Persists the notification record and delivers via FCM.
 *
 * @param {string} userId - The recipient's profile UUID.
 * @param {string} title - Notification title.
 * @param {string} body - Notification body.
 * @param {string} notifType - Notification type for categorisation.
 * @param {object} [metadata={}] - Optional metadata to persist.
 */
export async function sendPushNotification(userId, title, body, notifType, metadata = {}) {
  // 1. Persist notification record
  if (supabase) {
    try {
      const { error } = await supabase
        .from('notifications')
        .insert({ user_id: userId, title, body, notif_type: notifType, metadata });

      if (error) {
        logger.error(`[NotificationService] Database insert failed: ${error.message}`);
      }
    } catch (dbErr) {
      logger.error(`[NotificationService] Database error: ${dbErr.message}`);
    }
  }

  // 2. FCM delivery (fire-and-forget)
  void sendFcmNotification(userId, { title, body }, { notifType, ...metadata });
}
