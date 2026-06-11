import { supabase, firebaseAdmin } from '../config/db.js';

/**
 * Deliver the delivery OTP to the customer through a secure out-of-band channel.
 *
 * @param {string} customerId - The customer's profile UUID.
 * @param {string} orderDisplayId - The display identifier of the order (e.g. #FFYYYYMMDDXXXX).
 * @param {string} otp - The 6-digit delivery OTP.
 */
export async function sendDeliveryOtpNotification(customerId, orderDisplayId, otp) {
  console.log(`[NotificationService] Delivering OTP for Order ${orderDisplayId} to Customer ${customerId}`);

  // 1. Database Notification Persistence
  // Insert a notification record so the customer app can fetch it via Supabase.
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: customerId,
        title: 'Delivery Verification OTP',
        body: `Your delivery OTP for order ${orderDisplayId} is ${otp}. Share this with the driver only after verifying your cargo has arrived safely.`,
        notif_type: 'delivery_otp',
        metadata: { order_display_id: orderDisplayId }
      });

    if (error) {
      console.error('[NotificationService] Database insert failed:', error.message);
    } else {
      console.log('[NotificationService] Secure database notification record created successfully.');
    }
  } catch (dbErr) {
    console.error('[NotificationService] Database connection error during notification insert:', dbErr.message);
  }

  // 2. Firebase Cloud Messaging (FCM) Push Notification Stub
  if (firebaseAdmin) {
    try {
      // In a production app, we would fetch the user's registered FCM token(s)
      // from a user_tokens or profiles table:
      // const fcmToken = await getUserFcmToken(customerId);
      //
      // and call the FCM admin messaging library:
      // await firebaseAdmin.messaging().send({
      //   token: fcmToken,
      //   notification: {
      //     title: 'Delivery Verification OTP',
      //     body: `Your OTP is ${otp}`,
      //   },
      //   data: { orderDisplayId }
      // });
      console.log(`[NotificationService] [FCM] Push Notification stub: Message sent for customer ${customerId}`);
    } catch (fcmErr) {
      console.error('[NotificationService] [FCM] FCM delivery failed:', fcmErr.message);
    }
  } else {
    console.warn('[NotificationService] [FCM] Firebase Admin is not configured. Skipping FCM push notification.');
  }

  // 3. SMS Gateway (e.g., Twilio) Stub
  if (process.env.TWILIO_AUTH_TOKEN) {
    console.log(`[NotificationService] [SMS] SMS stub: Sending SMS to customer phone containing OTP ${otp}`);
  } else {
    console.log(`[NotificationService] [SMS] SMS stub: No SMS gateway configured. Logging OTP out-of-band: ${otp}`);
  }
}
