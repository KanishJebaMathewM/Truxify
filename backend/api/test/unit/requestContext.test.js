/**
 * Request Context Manager using AsyncLocalStorage
 */
import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage();

/**
 * Retrieves the requestCache instance from the current AsyncLocalStorage store.
 * Returns null if outside a context or if no requestCache is found.
 * 
 * @returns {import('./requestCache.js').RequestCache | null}
 */
export function getRequestCache() {
  const store = requestContext.getStore();
  if (!store || store.requestCache == null) {
    return null;
  }
  return store.requestCache;
}

/**
 * Safely parses a JSON string with a fallback value.
 * Validates that the parsed result is a non-null plain object (not an array or primitive).
 * 
 * @param {string|any} input - The JSON string to parse.
 * @param {any} fallback - The fallback value to return if parsing fails or result is invalid.
 * @returns {any} The parsed object or fallback.
 */
export function safeJsonParseWithFallback(input, fallback) {
  if (input === null || input === undefined || input === '') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(input);
    
    // Ensure the top-level parsed result is a valid non-null object and not an array
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback;
    }

    return parsed;
  } catch (err) {
    return fallback;
  }
}

export default {
  requestContext,
  getRequestCache,
  safeJsonParseWithFallback,
};
