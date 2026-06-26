import { supabase, firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import crypto from 'crypto';

const TRANSIENT_ERROR_CODES = new Set([
  'messaging/too-many-topics',
  'messaging/internal-error',
  'messaging/unavailable',
  'messaging/server-unavailable',
]);

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

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

async function clearInvalidToken(userId) {
  if (!supabase) return;
  try {
    await supabase
      .from('profiles')
      .update({ fcm_token: null, fcm_token_updated_at: new Date().toISOString() })
      .eq('id', userId);
  } catch (dbErr) {
    logger.error(`[FCM] Failed to clear invalid FCM token for user ${userId}: ${dbErr.message}`);
  }
}

function isTransientError(code) {
  return TRANSIENT_ERROR_CODES.has(code);
}

function isInvalidTokenError(code) {
  return INVALID_TOKEN_CODES.has(code);
}

export async function sendFcmNotification(userId, notification, data = {}) {
  if (!firebaseAdmin || !firebaseAdmin.messaging) {
    logger.warn('[FCM] Firebase not configured — skipping push notification');
    return { success: false, error: 'Firebase not configured' };
  }

  const fcmToken = await getUserFcmToken(userId);
  if (!fcmToken) {
    logger.warn(`[FCM] No FCM token for user ${userId} — skipping push notification`);
    return { success: false, error: 'No FCM token' };
  }

  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const messageId = await firebaseAdmin.messaging().send({
        token: fcmToken,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: stringData,
      });

      logger.info(`[FCM] Push notification sent to user ${userId} — messageId: ${messageId}`);
      return { success: true, messageId };
    } catch (err) {
      lastError = err;
      logger.error(`[FCM] Delivery failed for user ${userId} (attempt ${attempt + 1}/${MAX_RETRIES}) — errorCode: ${err.code ?? 'unknown'} — ${err.message}`);

      if (isInvalidTokenError(err.code)) {
        logger.warn(`[FCM] Clearing invalid FCM token for user ${userId} due to error: ${err.code}`);
        await clearInvalidToken(userId);
        return { success: false, error: err.message, errorCode: err.code };
      }

      if (isTransientError(err.code) && attempt < MAX_RETRIES - 1) {
        logger.info(`[FCM] Retrying after ${RETRY_DELAYS[attempt]}ms for user ${userId}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }
  }

  return { success: false, error: lastError?.message || 'Unknown error', errorCode: lastError?.code };
}

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
    logger.error('[NotificationService] Failed to store OTP:', error.message);
    return null;
  }

  logger.info(`[NotificationService] OTP stored for order ${orderId}, expires at ${expiresAt}`);
  return data;
}

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
    logger.error('[NotificationService] Failed to fetch active OTP:', error.message);
    return null;
  }

  return data;
}

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
    logger.error('[NotificationService] Failed to verify OTP:', error.message);
    return false;
  }

  return true;
}

export async function expireDeliveryOtps(orderId) {
  const { error } = await supabase
    .from('delivery_otps')
    .update({ expires_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('verified', false);

  if (error) {
    logger.error('[NotificationService] Failed to expire OTPs:', error.message);
  }
}

export async function sendDeliveryOtpNotification(customerId, orderDisplayId, otp) {
  logger.info(`[NotificationService] Delivering OTP for Order ${orderDisplayId} to Customer ${customerId}`);

  const title = 'Delivery Verification OTP';
  const body = `Your delivery OTP for order ${orderDisplayId} is ready. Share this with the driver only after verifying your cargo has arrived safely.`;
  const otpHash = crypto.createHash('sha256').update(String(otp)).digest('hex');

  let dbSuccess = false;
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: customerId,
        title,
        body,
        notif_type: 'order_update',
        metadata: { order_display_id: orderDisplayId, delivery_otp_hash: otpHash },
      });

    if (error) {
      logger.error('[NotificationService] Database insert failed:', error);
    } else {
      logger.info('[NotificationService] Notification inserted successfully');
      dbSuccess = true;
    }
  } catch (dbErr) {
    logger.error('[NotificationService] Database connection error during notification insert:', dbErr.message);
  }

  let fcmResult;
  try { fcmResult = await sendFcmNotification(
    customerId,
    { title: 'Delivery Verification OTP', body: `A delivery OTP has been generated for order ${orderDisplayId}. Open the app to view the code.` },
    { orderDisplayId, notifType: 'delivery_otp' }
  ); } catch (_) { /* logged internally by sendFcmNotification */ }

  if (process.env.TWILIO_AUTH_TOKEN) {
    logger.info(`[NotificationService] [SMS] SMS stub: Sending OTP for order ${orderDisplayId} (masked)`);
  } else {
    logger.info(`[NotificationService] [SMS] SMS stub: No SMS gateway configured. OTP sent out-of-band for order ${orderDisplayId} (masked)`);
  }

  return { success: dbSuccess || fcmResult?.success, fcm: fcmResult };
}

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

  let fcmResult;
  try { fcmResult = await sendFcmNotification(userId, { title, body }, { notifType, ...metadata }); } catch (_) { /* logged internally */ }
  return { success: fcmResult?.success, fcm: fcmResult };
}
