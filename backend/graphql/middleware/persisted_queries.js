// Stub for spec 39
// === Spec 39: persisted query hash ===
import crypto from 'crypto';
export function verifyPersistedQueryHash(q, h) {
  if (typeof q !== 'string' || typeof h !== 'string') return false;
  const c = crypto.createHash('sha256').update(q).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(c, 'hex'), Buffer.from(h, 'hex')); }
  catch (_) { return false; }
}

