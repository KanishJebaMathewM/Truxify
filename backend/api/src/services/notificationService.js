import { supabaseAdmin, firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import crypto from 'crypto';
import { measureExecution } from '../core/performanceMetrics.js';
import { hashOtp, verifyOtpHash } from '../lib/otpHashing.js';
import { DomainError } from './order/domainError.js';

// ============================================================================
// FCM fan-out configuration
// ============================================================================

// Firebase Admin SDK v14 caps sendEachForMulticast at FCM_MAX_BATCH_SIZE (500)
// tokens per request. Tokens are chunked to this bound — never a single
// unbounded request.
const FCM_MAX_BATCH_SIZE = 500;

// Allowlist mirrors the notifications.notif_type CHECK constraint.
const ALLOWED_NOTIF_TYPES = new Set([
  'order_update',
  'payment',
  'load_offer',
  'trip_update',
  'document',
  'system',
  'bid_accepted',
  'new_bid',
  'payment_locked',
  'payment_released',
]);

// Tokens that can never be delivered again — the device row is deactivated so
// future notifications stop targeting it. Exact client codes from the installed
// firebase-admin v14 (MessagingErrorCode).
const PERMANENT_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/installation-id-not-registered',
  'messaging/invalid-package-name',
  'messaging/mismatched-credential',
]);

// Provider-side / rate-limit failures. The device stays active and remains
// eligible for future delivery. These are never grounds for deactivation.
const TRANSIENT_ERROR_CODES = new Set([
  'messaging/too-many-topics',
  'messaging/internal-error',
  'messaging/unavailable',
  'messaging/server-unavailable',
  'messaging/device-message-rate-exceeded',
  'messaging/topics-message-rate-exceeded',
  'messaging/message-rate-exceeded',
]);

// Malformed payload / request errors. Reported as failures but NOT treated as
// device invalidity — the device stays active.
const INVALID_PAYLOAD_ERROR_CODES = new Set([
  'messaging/invalid-argument',
  'messaging/invalid-recipient',
  'messaging/invalid-payload',
  'messaging/invalid-data-payload-key',
  'messaging/payload-size-limit-exceeded',
  'messaging/invalid-options',
]);

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 500;
const RETRY_MAX_DELAY = 5000;

const REDIS_NOTIF_CHANNEL = 'truxify:notifications';
async function publishNotificationEvent(userId, event) {
  const { redisClient } = await import('../config/db.js');
  if (!redisClient) return;
  try {
    const payload = JSON.stringify({ userId, event, timestamp: new Date().toISOString() });
    await redisClient.publish(REDIS_NOTIF_CHANNEL, payload);
  } catch (err) {
    logger.error({ event: 'REDIS_NOTIF_PUBLISH_ERROR', userId, err: err?.message }, '[NotificationService] Failed to publish notification event to Redis');
  }
}

function calculateRetryBackoff(attempt) {
  const delay = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt), RETRY_MAX_DELAY);
  return delay + Math.floor(Math.random() * 200);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Safe redaction for diagnostic logs. Full FCM tokens must never be logged.
 */
function redactToken(token) {
  if (!token || typeof token !== 'string') return '[none]';
  if (token.length <= 8) return '[redacted]';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * One-way digest used when a token identity must appear in logs.
 */
function tokenFingerprint(token) {
  if (!token || typeof token !== 'string') return 'none';
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/**
 * Load all ACTIVE device records belonging to the user. user_devices is the
 * primary source of FCM tokens for fan-out.
 */
async function loadActiveDevices(userId) {
  if (!supabaseAdmin) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('user_devices')
      .select('id, fcm_token, platform, device_id')
      .eq('user_id', userId)
      .eq('is_active', true);
    if (error) {
      logger.error(`[FCM] Failed to load active devices for user ${userId}: ${error.message}`);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logger.error(`[FCM] Failed to load active devices for user ${userId}: ${err.message}`);
    return [];
  }
}

/**
 * Backward-compatibility source: the single profile-level token. Only used as a
 * controlled fallback when the user has no active device records.
 */
async function getProfileFcmToken(userId) {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('fcm_token')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.fcm_token) return null;
    return data.fcm_token;
  } catch (err) {
    logger.error({ err }, '[NotificationService] Failed to fetch FCM token');
    return null;
  }
}

/**
 * Deduplicate FCM tokens BEFORE sending so the same physical token is never
 * targeted more than once, even if multiple device records reference it.
 *
 * Returns a Map of token → { deviceIds: string[] }.
 */
function dedupeTokens(devices) {
  const byToken = new Map();
  for (const device of devices || []) {
    const token = device?.fcm_token;
    if (!token || typeof token !== 'string') continue;
    const entry = byToken.get(token);
    if (entry) {
      entry.deviceIds.push(device.id);
    } else {
      byToken.set(token, { deviceIds: device.id ? [device.id] : [] });
    }
  }
  return byToken;
}

async function clearInvalidToken(userId) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin
      .from('profiles')
      .update({
        fcm_token: null,
        fcm_token_updated_at: new Date().toISOString()
      })
      .eq('id', userId);
  } catch (dbErr) {
    logger.error({ err: dbErr, userId }, '[FCM] Failed to clear invalid FCM token');
  }
  return;
}

/**
 * Split tokens into SDK-bounded chunks.
 */
function chunkTokens(tokens) {
  const chunks = [];
  for (let i = 0; i < tokens.length; i += FCM_MAX_BATCH_SIZE) {
    chunks.push(tokens.slice(i, i + FCM_MAX_BATCH_SIZE));
  }
  return chunks;
}

/**
 * Classify an FCM error code into a delivery category.
 */
function classifyError(code) {
  if (PERMANENT_TOKEN_ERROR_CODES.has(code)) return 'permanent';
  if (TRANSIENT_ERROR_CODES.has(code)) return 'transient';
  if (INVALID_PAYLOAD_ERROR_CODES.has(code)) return 'invalid-payload';
  return 'unknown';
}

/**
 * Deactivate permanently-invalid devices and clear the profile fallback token
 * if it pointed at one of the invalidated tokens.
 */
async function deactivateInvalidDevices(deviceIds, userId, invalidatedTokens) {
  if (!supabaseAdmin) return 0;
  if (deviceIds.length === 0 && invalidatedTokens.length === 0) return 0;

  let deactivated = 0;
  if (deviceIds.length > 0) {
    try {
      const { error } = await supabaseAdmin
        .from('user_devices')
        .update({
          is_active: false,
          deactivated_at: new Date().toISOString(),
        })
        .in('id', deviceIds);
      if (error) {
        logger.error(`[FCM] Failed to deactivate invalid devices for user ${userId}: ${error.message}`);
      } else {
        deactivated = deviceIds.length;
        logger.info(`[FCM] Deactivated ${deactivated} invalid device(s) for user ${userId}.`);
      }
    } catch (dbErr) {
      logger.error(`[FCM] Failed to deactivate invalid devices for user ${userId}: ${dbErr.message}`);
    }
  }

  if (invalidatedTokens.length > 0) {
    try {
      await supabaseAdmin
        .from('profiles')
        .update({
          fcm_token: null,
          fcm_token_updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .in('fcm_token', invalidatedTokens);
    } catch (dbErr) {
      logger.error(`[FCM] Failed to clear invalid profile FCM token for user ${userId}: ${dbErr.message}`);
    }
  }

  return deactivated;
}

/**
 * Record successful delivery as a last-seen touchpoint so active devices are
 * never swept by the stale-device policy.
 */
async function touchDevicesLastSeen(deviceIds) {
  if (!supabaseAdmin || deviceIds.length === 0) return;
  try {
    await supabaseAdmin
      .from('user_devices')
      .update({ last_seen: new Date().toISOString() })
      .in('id', deviceIds);
  } catch (dbErr) {
    logger.warn(`[FCM] Failed to update device last_seen: ${dbErr.message}`);
  }
}

/**
 * Send one chunk with retries limited to provider-side transient failures.
 * Per-device permanent errors surface in BatchResponse.responses and are
 * handled by the caller; this only retries whole-chunk transport failures.
 */
async function sendBatchWithRetry(chunkTokens, message, userId, chunkIndex) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const batchResponse = await firebaseAdmin.messaging().sendEachForMulticast({
        tokens: chunkTokens,
        notification: message.notification,
        ...(message.data ? { data: message.data } : {}),
      });
      return { rejected: false, batchResponse };
    } catch (err) {
      lastError = err;
      const code = err?.code ?? 'unknown';
      logger.error(
        `[FCM] Batch ${chunkIndex} delivery failed for user ${userId} (attempt ${attempt + 1}/${MAX_RETRIES}) — errorCode: ${code}`,
        { err, userId, attempt: attempt + 1, maxRetries: MAX_RETRIES },
        '[FCM] Delivery failed for user'
      );
      const category = classifyError(code);
      if (category === 'transient' && attempt < MAX_RETRIES - 1) {
        const delay = calculateRetryBackoff(attempt);
        logger.info(`[FCM] Retrying batch ${chunkIndex} after ${delay}ms for user ${userId}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return { rejected: true, error: err };
      }
    }
  }
  return { rejected: true, error: lastError };
}

/**
 * Fan out one push notification to every ACTIVE device belonging to the user.
 *
 *   Notification Request
 *        ↓
 *   Load Active Devices (user_devices)
 *        ↓
 *   Deduplicate FCM Tokens
 *        ↓
 *   Chunk → sendEachForMulticast
 *        ↓
 *   Per-Device Result → Success / Failure
 *        ↓
 *   Deactivate Permanent Invalid Tokens
 *
 * A failure on one device NEVER prevents delivery to the user's other devices.
 */
export async function sendFcmNotification(userId, notification, data = {}) {
  return measureExecution('NotificationService.sendFcmNotification', async () => {
    if (!firebaseAdmin || !firebaseAdmin.messaging) {
      logger.warn('[FCM] Firebase not configured — skipping push notification');
      return { success: false, error: 'Firebase not configured', errorCode: 'FCM_NOT_CONFIGURED' };
    }

    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)])
    );
    const message = {
      notification: {
        title: notification?.title,
        body: notification?.body,
      },
      ...(Object.keys(stringData).length > 0 ? { data: stringData } : {}),
    };

    const activeDevices = await loadActiveDevices(userId);
    const tokenMap = dedupeTokens(activeDevices);
    const tokens = [...tokenMap.keys()];

    // Controlled backward-compat fallback: only when the user has NO active
    // device records. Deduplication (Map) prevents double-sending if the same
    // token exists both in user_devices and profiles.
    if (tokens.length === 0) {
      const profileToken = await getProfileFcmToken(userId);
      if (profileToken) {
        tokens.push(profileToken);
        tokenMap.set(profileToken, { deviceIds: [], fromProfile: true });
      }
    }

    if (tokens.length === 0) {
      logger.warn(`[FCM] No active devices or FCM token for user ${userId} — skipping push notification`);
      return { success: false, error: 'No FCM token', errorCode: 'NO_FCM_TOKEN' };
    }

    const summary = {
      devicesFound: activeDevices.length,
      uniqueTokens: tokens.length,
      batches: 0,
      delivered: 0,
      permanent: 0,
      transient: 0,
      invalidPayload: 0,
      unknown: 0,
      deactivated: 0,
    };

    const messageIds = [];
    let lastError = null;
    let lastErrorCode = null;

    const chunks = chunkTokens(tokens);
    summary.batches = chunks.length;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const sent = await sendBatchWithRetry(chunk, message, userId, i + 1);

      if (sent.rejected) {
        const code = sent.error?.code ?? 'unknown';
        const category = classifyError(code);
        if (category === 'transient') summary.transient += chunk.length;
        else if (category === 'invalid-payload') summary.invalidPayload += chunk.length;
        else summary.unknown += chunk.length;
        lastError = sent.error;
        lastErrorCode = code;
        continue;
      }

      const responses = sent.batchResponse?.responses ?? [];
      const invalidDeviceIds = [];
      const invalidTokens = [];
      const touchedDeviceIds = [];

      for (let j = 0; j < responses.length; j++) {
        const resp = responses[j];
        const token = chunk[j];
        const entry = tokenMap.get(token);
        const deviceIds = entry?.deviceIds ?? [];

        if (resp?.success) {
          summary.delivered += 1;
          if (resp.messageId) messageIds.push(resp.messageId);
          touchedDeviceIds.push(...deviceIds);
          continue;
        }

        const code = resp?.error?.code ?? 'unknown';
        const category = classifyError(code);
        if (category === 'permanent') {
          summary.permanent += 1;
          invalidDeviceIds.push(...deviceIds);
          invalidTokens.push(token);
          logger.warn(
            `[FCM] Permanent token error for user ${userId} — deactivating device (code: ${code}, token fp: ${tokenFingerprint(token)})`
          );
        } else if (category === 'transient') {
          summary.transient += 1;
          logger.warn(`[FCM] Temporary FCM failure for user ${userId} — device kept active (code: ${code})`);
        } else if (category === 'invalid-payload') {
          summary.invalidPayload += 1;
          logger.warn(`[FCM] Invalid payload for user ${userId} — device kept active (code: ${code})`);
        } else {
          summary.unknown += 1;
          logger.warn(`[FCM] Unknown FCM error for user ${userId} — device kept active (code: ${code})`);
        }

        if (!lastError) {
          lastError = resp?.error ?? new Error(`Delivery failed: ${code}`);
          lastErrorCode = code;
        }
      }

      if (touchedDeviceIds.length > 0) {
        await touchDevicesLastSeen([...new Set(touchedDeviceIds)]);
      }
      if (invalidDeviceIds.length > 0 || invalidTokens.length > 0) {
        summary.deactivated += await deactivateInvalidDevices(
          [...new Set(invalidDeviceIds)],
          userId,
          [...new Set(invalidTokens)]
        );
      }
    }

    const success = summary.delivered > 0;
    const result = {
      success,
      ...(success && messageIds.length > 0 ? { messageId: messageIds[0] } : {}),
      ...(!success ? { error: lastError?.message ?? 'Delivery failed', errorCode: lastErrorCode ?? 'UNKNOWN_ERROR' } : {}),
      summary,
    };

    logger.info(
      `[FCM] Fan-out complete for user ${userId}: delivered=${summary.delivered}/${summary.uniqueTokens} ` +
      `batches=${summary.batches} permanent=${summary.permanent} transient=${summary.transient} ` +
      `invalidPayload=${summary.invalidPayload} unknown=${summary.unknown} deactivated=${summary.deactivated}`
    );
    return result;
  });
}

// ============================================================================
// Delivery-OTP subsystem (unchanged)
// ============================================================================
export const hashDeliveryOtp = hashOtp;
export const verifyDeliveryOtpHash = verifyOtpHash;

export async function storeDeliveryOtp(orderId, otp, ttlMinutes = 15) {
  return measureExecution('NotificationService.storeDeliveryOtp', async () => {
    if (!supabaseAdmin) {
      logger.error({}, '[NotificationService] Service-role client not configured — cannot store OTP.');
      return null;
    }

    // Invalidate all existing unverified OTPs for this order so that only one
    // active OTP can ever exist per order within the TTL window. This prevents
    // an attacker who obtained an older OTP from using it after a new one is
    // issued (see issue #11205).
    const { error: invalidateError } = await supabaseAdmin
      .from('delivery_otps')
      .update({ expires_at: new Date().toISOString(), verified: true })
      .eq('order_id', orderId)
      .eq('verified', false);

    if (invalidateError) {
      logger.error({ err: invalidateError }, '[NotificationService] Failed to invalidate existing OTPs');
    }

    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const { hash: otpHash, salt: otpSalt } = hashDeliveryOtp(otp);

    const { data, error } = await supabaseAdmin
      .from('delivery_otps')
      .insert({
        order_id: orderId,
        otp_hash: otpHash,
        otp_salt: otpSalt,
        expires_at: expiresAt,
        verified: false
      })
      .select('id')
      .single();

    if (error) {
      logger.error({ err: error }, '[NotificationService] Failed to store OTP');
      return null;
    }

    logger.info(`[NotificationService] OTP stored for order ${orderId}, expires at ${expiresAt}`);
    return data;
  });
}

export async function getActiveDeliveryOtp(orderId) {
  return measureExecution('NotificationService.getActiveDeliveryOtp', async () => {
    if (!supabaseAdmin) {
      logger.error({}, '[NotificationService] Service-role client not configured — cannot read OTP.');
      return null;
    }
    const { data, error } = await supabaseAdmin
      .from('delivery_otps')
      .select('id, otp_hash, otp_salt, expires_at')
      .eq('order_id', orderId)
      .eq('verified', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ err: error }, '[NotificationService] Failed to fetch active OTP');
      return null;
    }

    return data;
  });
}

export async function verifyDeliveryOtp(otpId) {
  return measureExecution('NotificationService.verifyDeliveryOtp', async () => {
    // Target a specific OTP record by ID instead of bulk-updating all
    // unverified OTPs for an order. This ensures only the matched OTP
    // (which was validated by the caller via timing-safe hash comparison)
    // is consumed, preventing any future caller from bypassing verification.
    if (!supabaseAdmin) {
      logger.error({}, '[NotificationService] Service-role client not configured — cannot verify OTP.');
      return false;
    }
    const { data, error } = await supabaseAdmin
      .from('delivery_otps')
      .update({
        verified: true,
        verified_at: new Date().toISOString()
      })
      .eq('id', otpId)
      .eq('verified', false)
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error(
        { event: 'NOTIFICATION_INSERT_ERROR', error: error && error.message },
        'Error inserting notification',
      );
      throw error;
    }

    if (!data) {
      logger.warn('[NotificationService] OTP not found or already verified:', otpId);
      return false;
    }

    return true;
  });
}

export async function expireDeliveryOtps(orderId) {
  return measureExecution('NotificationService.expireDeliveryOtps', async () => {
    if (!supabaseAdmin) {
      logger.error({}, '[NotificationService] Service-role client not configured — cannot expire OTPs.');
      return;
    }
    const { error } = await supabaseAdmin
      .from('delivery_otps')
      .update({ expires_at: new Date().toISOString() })
      .eq('order_id', orderId)
      .eq('verified', false);

    if (error) {
      logger.error({ err: error }, '[NotificationService] Failed to expire OTPs');
    }
  });
}

// ============================================================================
// Orchestration entry points
// ============================================================================

/**
 * Persist a notification row with notif_type allowlist validation.
 * Kept as a reusable primitive; sendPushNotification uses it internally.
 */
export async function insertNotification(notificationData) {
  const notifType = notificationData?.notif_type;
  if (notifType && !ALLOWED_NOTIF_TYPES.has(notifType)) {
    throw new DomainError(400, { error: `Invalid notif_type: ${notifType}` });
  }
  if (!supabaseAdmin) {
    logger.error('[NotificationService] Service-role client not configured — cannot persist notification.');
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert(notificationData)
    .select()
    .single();
  if (error) {
    logger.error('[NotificationService] Database insert failed:', error.message);
    return null;
  }
  return data;
}

/**
 * Existing push entry point used by order lifecycle, payments, escrow and
 * document flows. Persists to the notifications table, then fans the push out
 * to every active device via sendFcmNotification.
 */
export async function sendPushNotification(userId, title, body, notifType, metadata = {}) {
  return measureExecution('NotificationService.sendPushNotification', async () => {
    if (notifType && !ALLOWED_NOTIF_TYPES.has(notifType)) {
      throw new DomainError(400, { error: `Invalid notif_type: ${notifType}` });
    }

    if (supabaseAdmin) {
      try {
        const { error } = await supabaseAdmin.from('notifications').insert({
          user_id: userId,
          title,
          body,
          notif_type: notifType,
          metadata,
        });

        if (error) {
          logger.error(`[NotificationService] Database insert failed: ${error.message}`);
        }
      } catch (dbErr) {
        logger.error(`[NotificationService] Database error: ${dbErr.message}`);
      }
    }

    let fcmResult;
    try {
      fcmResult = await sendFcmNotification(userId, { title, body }, { notifType, ...metadata });
    } catch (err) {
      logger.error({ err: err?.message ?? String(err) }, 'Unexpected sendFcmNotification error');
      fcmResult = { success: false, error: err?.message ?? String(err) };
    }
    return { success: fcmResult?.success, fcm: fcmResult };
  });
}

export async function sendDeliveryOtpNotification(customerId, orderDisplayId, otp) {
  logger.info(`[NotificationService] Delivering OTP for Order ${orderDisplayId} to Customer ${customerId}`);

  const title = 'Delivery Verification OTP';
  const body = `Your delivery OTP for order ${orderDisplayId} is ready. Share this with the driver only after verifying your cargo has arrived safely.`;

  let dbSuccess = false;
  try {
    if (!supabaseAdmin) {
      logger.error({}, '[NotificationService] Service-role client not configured — cannot persist notification.');
      dbSuccess = false;
    } else {
      const { error } = await supabaseAdmin.from('notifications').insert({
        user_id: customerId,
        title,
        body,
        notif_type: 'delivery_otp',
        // No OTP or OTP-derived value is persisted here: an unsalted digest of
        // a 6-digit code is offline-brute-forceable if the table leaks.
        metadata: { order_display_id: orderDisplayId }
      });

      if (error) {
        logger.error({ err: error }, '[NotificationService] Database insert failed');
      } else {
        logger.info('[NotificationService] Notification inserted successfully');
        dbSuccess = true;
      }
    }
  } catch (dbErr) {
    logger.error({ err: dbErr }, '[NotificationService] Database connection error during notification insert');
  }

  let fcmResult;
  try {
    fcmResult = await sendFcmNotification(
      customerId,
      { title, body },
      { orderDisplayId, notifType: 'delivery_otp' }
    );
  } catch (err) {
    logger.error({ err: err?.message ?? String(err) }, 'Unexpected sendFcmNotification error');
  }

  return { success: dbSuccess || fcmResult?.success, fcm: fcmResult };
}
