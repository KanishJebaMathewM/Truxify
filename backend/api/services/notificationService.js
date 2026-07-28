import admin from 'firebase-admin';

// Ensure Firebase Admin is initialized once (call this from your app entry point)
export function initFirebaseAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Replace newlines in env var
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
}

/**
 * Send a push notification to a single device.
 * @param {string} fcmToken - The recipient's FCM registration token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} data - Optional key-value data payload
 */
export async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken) {
    console.warn('[FCM] Skipping notification: no FCM token provided');
    return null;
  }

  const message = {
    token: fcmToken,
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(`[FCM] Notification sent: ${response}`);
    return response;
  } catch (error) {
    console.error('[FCM] Error sending notification:', error.code, error.message);
    // Token invalid/expired — caller should remove from DB
    if (error.code === 'messaging/registration-token-not-registered') {
      throw new Error('FCM_TOKEN_INVALID');
    }
    throw error;
  }
}

// Convenience helpers for key Truxify events

export async function notifyLoadMatch(driver, load, estimatedEarnings) {
  return sendPushNotification(
    driver.fcmToken,
    '🚛 New Load Match',
    `${load.origin} → ${load.destination} | ₹${estimatedEarnings}`,
    { type: 'LOAD_MATCH', loadId: String(load._id) }
  );
}

export async function notifyDriverAccepted(manufacturer, driver, load) {
  return sendPushNotification(
    manufacturer.fcmToken,
    '✅ Driver Accepted Your Load',
    `${driver.name} will pick up from ${load.origin}`,
    { type: 'DRIVER_ACCEPTED', loadId: String(load._id) }
  );
}

export async function notifyDeliveryComplete(manufacturer, load) {
  return sendPushNotification(
    manufacturer.fcmToken,
    '📦 Delivery Complete',
    `Your shipment to ${load.destination} has been delivered`,
    { type: 'DELIVERY_COMPLETE', loadId: String(load._id) }
  );
}