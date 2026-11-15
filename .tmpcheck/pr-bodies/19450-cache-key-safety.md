## Problem

`cacheMiddleware()` in `backend/api/src/middleware/cacheMiddleware.js` accepts any TTL, prefix, and key generator. A null or empty generated key collapses unrelated requests into a single `cache:prefix:undefined` entry, and responses that set cookies or belong to an authenticated user can be cached and served to another caller. Invalid configuration is also deferred until the first request.

## Change

- Validate TTL, key prefix, and key generator when the middleware is constructed.
- Bypass caching for null, undefined, empty, or non-primitive generated keys.
- Skip response caching when `Set-Cookie` is present or the response is outside the successful JSON path.

## Verification

- Construct the middleware with zero/NaN TTL, an empty prefix, and a non-function generator; assert a TypeError.
- Return null and object keys from the generator and assert the request reaches the handler without a cache read or write.
- Return a response with `Set-Cookie` and assert it is not written to Redis.

Closes #19450
