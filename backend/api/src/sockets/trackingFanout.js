import logger from '../middleware/logger.js';

const DEFAULT_LIMIT = 1024 * 1024;
const MAXIMUM_LIMIT = 16 * 1024 * 1024;
const retired = new WeakSet();

export function trackingBufferLimit(value = process.env.TRACKER_MAX_BUFFERED_BYTES) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.min(Math.floor(parsed), MAXIMUM_LIMIT)) : DEFAULT_LIMIT;
}

function retire(client, reason) {
  if (retired.has(client)) return;
  retired.add(client);
  logger.warn({ socketId: client.socketId, reason }, '[Tracker] Retiring failed or slow fanout consumer');
  try { client.terminate?.(); } catch { /* Other subscribers must still progress. */ }
}

/** Counts admitted sends, not peer receipts; no additional pending queue. */
export function fanoutTrackingPayload(clients, payload, limit = trackingBufferLimit()) {
  const bytes = Buffer.byteLength(payload);
  const seen = new Set();
  let admitted = 0;
  for (const client of clients) {
    if (seen.has(client)) continue;
    seen.add(client);
    if (client.readyState !== 1 || retired.has(client)) continue;
    const buffered = client.bufferedAmount ?? 0;
    if (!Number.isFinite(buffered) || buffered < 0 || bytes > limit || buffered > limit - bytes) {
      retire(client, 'queued-byte limit');
      continue;
    }
    let failed = false;
    try {
      client.send(payload, error => {
        if (error) { failed = true; retire(client, 'send callback error'); }
      });
      if (!failed) admitted++;
    } catch {
      retire(client, 'synchronous send error');
    }
  }
  return admitted;
}
