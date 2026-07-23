import { supabase, redisClient } from '../config/db.js';
import { sendPushNotification } from './notificationService.js';
import logger from '../middleware/logger.js';

const REMINDER_WINDOWS = [
  { days: 30, label: '30 days' },
  { days: 14, label: '14 days' },
  { days: 7, label: '7 days' },
];

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = 'document:expiry:worker:lock';
const LOCK_TTL_SECONDS = 600;
const LEASE_EXTENSION_INTERVAL_MS = (LOCK_TTL_SECONDS * 1000) / 2;

const DOC_TYPE_LABELS = {
  rc_book: 'RC Book',
  driving_licence: 'Driving Licence',
  insurance: 'Insurance Policy',
  puc: 'Pollution Certificate',
  aadhar: 'Aadhaar Card',
  aadhaar_card: 'Aadhaar Card',
  pan: 'PAN Card',
  pan_card: 'PAN Card',
  business_license: 'Business License',
  bank_account: 'Bank Account',
};

let workerTimer = null;
let workerRunning = false;

function getDocTypeLabel(docType) {
  return DOC_TYPE_LABELS[docType] ?? docType ?? 'Document';
}

function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

async function hasExistingNotification(userId, documentId, daysRemaining) {
  if (!supabase) return false;
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('notifications')
      .select('id, metadata')
      .eq('user_id', userId)
      .eq('notif_type', 'document_expiry')
      .gte('created_at', cutoff);

    if (error || !data || data.length === 0) return false;

    return data.some(
      (n) => n.metadata?.documentId === documentId &&
             String(n.metadata?.daysRemaining) === String(daysRemaining),
    );
  } catch {
    return false;
  }
}

export async function processDocumentExpiryBatch() {
  let lockAcquired = false;
  let leaseExtender = null;

  if (redisClient) {
    try {
      const acquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      if (!acquired) {
        logger.info('[document-expiry] Lock held by another instance, skipping.');
        return;
      }
      lockAcquired = true;
      leaseExtender = setInterval(async () => {
        try {
          await redisClient.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        } catch (err) {
          logger.warn('[document-expiry] Failed to extend lock lease:', err.message);
        }
      }, LEASE_EXTENSION_INTERVAL_MS);
    } catch (err) {
      logger.error('[document-expiry] Failed to acquire Redis lock, skipping batch:', err.message);
      return;
    }
  } else {
    if (workerRunning) return;
    workerRunning = true;
  }

  if (!lockAcquired && !redisClient) {
    logger.warn('[document-expiry] Redis unavailable, running in single-instance mode.');
  }

  const now = new Date();
  let totalNotificationsSent = 0;

  try {
    for (const window of REMINDER_WINDOWS) {
      const windowStart = startOfDay(new Date(now.getTime() + window.days * 24 * 60 * 60 * 1000));
      const windowEnd = endOfDay(new Date(now.getTime() + window.days * 24 * 60 * 60 * 1000));

      let documents = [];
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('id, user_id, doc_type, valid_until')
          .not('valid_until', 'is', null)
          .gte('valid_until', windowStart.toISOString())
          .lte('valid_until', windowEnd.toISOString());

        if (error) {
          logger.error(`[document-expiry] Failed to query documents for ${window.label} window:`, error.message);
          continue;
        }

        documents = data || [];
      } catch (err) {
        logger.error(`[document-expiry] Error querying documents for ${window.label} window:`, err.message);
        continue;
      }

      if (documents.length === 0) {
        logger.info(`[document-expiry] No documents expiring in ${window.label} window.`);
        continue;
      }

      logger.info(`[document-expiry] Found ${documents.length} document(s) expiring in ${window.label} window.`);

      for (const doc of documents) {
        if (!doc.user_id || !doc.id) {
          logger.warn('[document-expiry] Skipping document with missing user_id or id:', doc.id);
          continue;
        }

        const alreadyNotified = await hasExistingNotification(doc.user_id, doc.id, window.days);
        if (alreadyNotified) {
          logger.info(`[document-expiry] Document ${doc.id} already notified for ${window.label} window, skipping.`);
          continue;
        }

        const docLabel = getDocTypeLabel(doc.doc_type);
        const expiryDate = new Date(doc.valid_until).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        const title = 'Document Expiry Alert';
        const body = `Your ${docLabel} expires in ${window.label}. Please renew before ${expiryDate} to avoid compliance issues.`;

        const metadata = {
          type: 'document_expiry',
          documentId: doc.id,
          documentType: doc.doc_type,
          daysRemaining: window.days,
          expiryDate: doc.valid_until,
        };

        try {
          await sendPushNotification(doc.user_id, title, body, 'document_expiry', metadata);
          totalNotificationsSent++;
          logger.info(`[document-expiry] Sent ${window.label} expiry alert for ${docLabel} (doc: ${doc.id}) to user ${doc.user_id}`);
        } catch (err) {
          logger.error(`[document-expiry] Failed to send notification for document ${doc.id}:`, err.message);
        }
      }
    }
  } finally {
    if (leaseExtender) {
      clearInterval(leaseExtender);
    }
    if (lockAcquired && redisClient) {
      await redisClient.del(LOCK_KEY).catch(() => {});
    }
    if (!lockAcquired) {
      workerRunning = false;
    }
  }

  logger.info(`[document-expiry] Batch complete. Total notifications sent: ${totalNotificationsSent}`);
}

export function startDocumentExpiryWorker() {
  if (workerTimer) return;

  const configuredInterval = Number(process.env.DOCUMENT_EXPIRY_WORKER_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  void processDocumentExpiryBatch();

  workerTimer = setInterval(() => {
    void processDocumentExpiryBatch();
  }, intervalMs);
  workerTimer.unref?.();

  logger.info(`[document-expiry] Worker started (interval: ${intervalMs}ms).`);
}

export function stopDocumentExpiryWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
  logger.info('[document-expiry] Worker stopped.');
}
