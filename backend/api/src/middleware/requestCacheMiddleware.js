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
