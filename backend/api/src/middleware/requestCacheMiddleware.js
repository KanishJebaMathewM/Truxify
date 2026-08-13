import { requestContext } from '../lib/requestContext.js';
import { RequestCache } from '../lib/requestCache.js';

export function requestCacheMiddleware(req, res, next) {
  const store = { requestCache: new RequestCache() };

  const clearCache = () => {
    store.requestCache.clear();
  };

  requestContext.run(store, () => {
    // Clear on finish AND on error so a response that dies mid-stream (e.g.
    // a socket error) cannot leak its request-scoped cache into the next
    // request handled by the same process.
    res.once('finish', clearCache);
    res.once('error', clearCache);
    res.once('close', clearCache);
    next();
  });
}
