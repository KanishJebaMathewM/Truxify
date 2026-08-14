# Request Cache Middleware

## Overview

The Truxify backend includes a request-scoped cache middleware that provides an in-memory cache for the duration of a single request, automatically cleared when the response finishes.

---

## Location

Middleware:

```
backend/api/src/middleware/requestCacheMiddleware.js
```

Cache implementation:

```
backend/api/src/lib/requestCache.js
backend/api/src/lib/requestContext.js
```

---

## How It Works

For each request:

1. A fresh `RequestCache` (a `Map`-backed store) is created.
2. The cache is stored in an `AsyncLocalStorage` context so any async code spawned by the handler can access it.
3. When the response finishes, the cache is cleared so no data leaks between requests.

Handlers and services retrieve the cache with:

```js
import { getRequestCache } from '../lib/requestContext.js';

const cache = getRequestCache();
if (cache) {
  cache.set('key', value);
  const hit = cache.get('key');
}
```

---

## Why It Exists

During a single request, the same expensive computation (a parsed payload, a normalized address, an aggregation) is often needed more than once. A request-scoped cache avoids recomputation without introducing the cross-request staleness concerns of a global cache.

---

## Behavior Notes

- The cache is per-request only — nothing persists across requests.
- `getRequestCache()` returns `null` outside of a request context.
- The cache is cleared automatically on response finish.

---

## Testing

Automated tests verify:

- A fresh cache is available inside the request context.
- The cache is cleared after the response finishes.
- `getRequestCache()` returns null outside a request.
