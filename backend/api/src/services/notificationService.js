import { supabase, firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import crypto from 'crypto';

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
 * Persist a delivery OTP in the isolated delivery_otps table.
 * Called when the order transitions to 'In Transit' and a fresh OTP is needed.
 *
 * @param {string} orderId - The order UUID.
 * @param {string} otp - The 6-digit delivery OTP.
 * @param {number} ttlMinutes - Time-to-live for the OTP (defaults to 15).
 * @returns {Promise<{id: string} | null>}
 */
export async function storeDeliveryOtp(orderId, otp, ttlMinutes = 15) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const otpHash = crypto.createHash('sha256').update(String(otp)).digest('hex');

  const { data, error } = await supabase
    .from('delivery_otps')
    .insert({
      order_id: orderId,
      otp_hash: otpHash,
      expires_at: expiresAt,
      verified: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[NotificationService] Failed to store OTP:', error.message);
    return null;
  }

  logger.info({ orderId, expiresAt }, 'OTP stored for order');
  return data;
}

/**
 * Retrieve the latest active (unexpired, unverified) OTP for an order.
 *
 * @param {string} orderId
 * @returns {Promise<{id: string, otp_hash: string, expires_at: string} | null>}
 */
export async function getActiveDeliveryOtp(orderId) {
  const { data, error } = await supabase
    .from('delivery_otps')
    .select('id, otp_hash, expires_at')
    .eq('order_id', orderId)
    .eq('verified', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[NotificationService] Failed to fetch active OTP:', error.message);
    return null;
  }

  return data;
}

/**
 * Mark a delivery OTP as verified.
 *
 * @param {string} orderId
 * @returns {Promise<boolean>}
 */
export async function verifyDeliveryOtp(orderId) {
  const { error } = await supabase
    .from('delivery_otps')
    .update({
      verified: true,
      verified_at: new Date().toISOString(),
    })
    .eq('order_id', orderId)
    .eq('verified', false);

  if (error) {
    console.error('[NotificationService] Failed to verify OTP:', error.message);
    return false;
  }

  return true;
}

/**
 * Invalidate (expire) all active OTPs for an order.
 *
 * @param {string} orderId
 * @returns {Promise<void>}
 */
export async function expireDeliveryOtps(orderId) {
  const { error } = await supabase
    .from('delivery_otps')
    .update({ expires_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('verified', false);

  if (error) {
    console.error('[NotificationService] Failed to expire OTPs:', error.message);
  }
}

/**
 * Deliver the delivery OTP to the customer through out-of-band channels.
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

  void sendFcmNotification(userId, { title, body }, { notifType, ...metadata });
}
