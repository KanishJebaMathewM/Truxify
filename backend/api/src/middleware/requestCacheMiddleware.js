import { requestContext } from '../lib/requestContext.js';
import { RequestCache } from '../lib/requestCache.js';

export function requestCacheMiddleware(req, res, next) {
  const store = { requestCache: new RequestCache() };

  requestContext.run(store, () => {
    res.once('finish', () => {
      store.requestCache.clear();
    });
    next();
  });
}
