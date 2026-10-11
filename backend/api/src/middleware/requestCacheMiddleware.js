import { randomUUID } from "crypto";
import { requestContext } from "../lib/requestContext.js";
import { RequestCache } from "../lib/requestCache.js";

export function requestCacheMiddleware(req, res, next) {
  const sessionId =
    typeof req.sessionId === "string" && req.sessionId.trim()
      ? req.sessionId.trim()
      : randomUUID();
  req.sessionId = sessionId;
  const store = { requestCache: new RequestCache(), sessionId };

  requestContext.run(store, () => {
    res.once("finish", () => {
      store.requestCache.clear();
    });
    next();
  });
}

// Merge-compat shim: main renamed this middleware to a `requestCache(ttl)`
// factory (0ef1600a60). When this branch merges, main's module wins; the shim
// keeps this branch's app.js (`requestCache()`) working standalone meanwhile.
export function requestCache(_durationSeconds = 60) {
  return requestCacheMiddleware;
}
