import { AsyncLocalStorage } from 'async_hooks';
import { RequestCache } from './requestCache.js';

export const requestContext = new AsyncLocalStorage();

export function getRequestCache() {
  const store = requestContext.getStore();
  return store?.requestCache ?? null;
}
