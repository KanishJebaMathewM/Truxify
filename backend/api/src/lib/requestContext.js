import { AsyncLocalStorage } from 'async_hooks';

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Retrieves the current request-scoped cache (Map), creating one if it doesn't exist.
 * Falls back to a global map if called outside an active request context.
 */
export function getRequestCache() {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return global.__fallbackRequestCache || (global.__fallbackRequestCache = new Map());
  }
  if (!store.cache) {
    store.cache = new Map();
  }
  return store.cache;
}

/**
 * Safely parses a JSON string, returning the fallback value if parsing fails or input is invalid.
 */
export function safeJsonParseWithFallback(str, fallback) {
  if (typeof str !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export { asyncLocalStorage };
