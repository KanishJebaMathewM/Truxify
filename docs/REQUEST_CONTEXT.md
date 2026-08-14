# Request Context & Request Cache

## Overview

The Truxify backend propagates request-scoped state across async code with `AsyncLocalStorage` and provides a per-request cache (`lib/requestContext.js` + `lib/requestCache.js`).

---

## Location

```
backend/api/src/lib/requestContext.js
backend/api/src/lib/requestCache.js
backend/api/src/middleware/requestCacheMiddleware.js
```

---

## Request Context

`requestContext` is an `AsyncLocalStorage` instance. The middleware runs each request inside `requestContext.run(store, ...)`, so any async work spawned by the handler can read the same store.

```js
import { requestContext, getRequestCache } from '../lib/requestContext.js';
```

`getRequestCache()` returns the current request's cache, or `null` outside a request context.

---

## Request Cache

`RequestCache` is a `Map`-backed LRU-free store:

| Method | Behavior |
|--------|----------|
| `set(key, value)` | Stores a value; returns the cache for chaining |
| `get(key)` | Returns the stored value or `undefined` |
| `has(key)` | Checks presence |
| `clear()` | Empties the cache |
| `size` | Entry count |

The middleware creates a fresh cache per request and clears it on response finish, so nothing leaks between requests.

---

## Why It Exists

Handlers often compute the same derived value (parsed payloads, normalized addresses, aggregations) multiple times within one request. A request-scoped cache avoids recomputation without the staleness concerns of a global cache.

---

## Testing

Automated tests verify:

- Cache get/set/has/clear semantics.
- Context isolation (nested runs).
- `getRequestCache()` null outside a request.
- Cache cleared on response finish.
