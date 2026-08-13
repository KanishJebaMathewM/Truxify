import { AsyncLocalStorage } from 'async_hooks';
import { RequestCache } from './requestCache.js';

export const requestContext = new AsyncLocalStorage();

export function getRequestCache() {
  const store = requestContext.getStore();
  return store?.requestCache ?? null;
}

export function safeParseContext(contextHeader, fallback = {}) {
  if (!contextHeader || typeof contextHeader !== 'string') return fallback;
  try {
    return JSON.parse(contextHeader);
  } catch (_err) {
    return fallback;
  }
}

