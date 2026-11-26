// backend/api/src/lib/correlationContext.js
import { AsyncLocalStorage } from 'async_hooks';

export const correlationContext = new AsyncLocalStorage();

/**
 * Returns the active request's correlation ID from AsyncLocalStorage, or null if none.
 * @returns {string|null}
 */
export function getCorrelationId() {
  const store = correlationContext.getStore();
  return store?.correlationId || null;
}

/**
 * Returns the active correlation store object.
 * @returns {Object}
 */
export function getCorrelationStore() {
  return correlationContext.getStore() || {};
}

export default {
  correlationContext,
  getCorrelationId,
  getCorrelationStore,
};
