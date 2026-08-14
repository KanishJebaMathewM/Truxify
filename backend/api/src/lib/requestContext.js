import { AsyncLocalStorage } from 'async_hooks';
import { RequestCache } from './requestCache.js';

export const requestContext = new AsyncLocalStorage();

export function getRequestCache() {
  const store = requestContext.getStore();
  return store?.requestCache ?? null;
}


// === Spec 1: ===
// === Spec 1: safe JSON parsing fallback ===
export function safeJsonParseWithFallback(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch (_) {}
  return fallback;
}

