import { supabase, firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

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

  // 1. Database Notification Persistence
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: customerId,
        title: 'Delivery Verification OTP',
        body: `Your delivery OTP for order ${orderDisplayId} is ${otp}. Share this with the driver only after verifying your cargo has arrived safely.`,
        notif_type: 'order_update',
        metadata: {
          order_display_id: orderDisplayId,
        },
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

  // 2. Firebase Cloud Messaging (FCM) Push Notification
  if (firebaseAdmin && firebaseAdmin.messaging) {
    try {
      // In production: fetch user FCM token from DB
      // const fcmToken = await getUserFcmToken(customerId);

      // Example safe structure (no crash if not configured)
      logger.info(`[FCM] Preparing push for user ${customerId}`);

      /*
      await firebaseAdmin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'Delivery Verification OTP',
          body: `Your OTP is ${otp}`
        },
        data: {
          orderDisplayId
        }
      });
      */

      logger.info(`[FCM] Push Notification stub executed for ${customerId}`);
    } catch (err) {
      logger.warn('[FCM] Skipped due to error:', err.message);
    }
  } else {
    logger.warn('[FCM] Firebase not configured — skipping push notification');
  }

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