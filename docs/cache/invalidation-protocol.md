# Cache Invalidation Protocol

## Overview
Truxify uses a distributed cache invalidation protocol to ensure consistency across multiple API instances. When one instance modifies or invalidates cached data, it publishes a `CacheEvent` via Redis Pub/Sub, prompting other instances to synchronize their local caches.

## Event Types
| Event Type | Description | Required Fields |
|------------|-------------|-----------------|
| `INVALIDATE_KEY` | Deletes a single specific cache key. | `namespace`, `key` |
| `INVALIDATE_PATTERN` | Deletes all keys matching a glob pattern. | `namespace`, `pattern` |
| `INVALIDATE_NAMESPACE` | Flushes all keys within a specific namespace. | `namespace` |
| `BUMP_VERSION` | Increments a version counter, logically invalidating all versioned keys. | `namespace` |
| `REFRESH` | Informational; triggers a background reload of a key. | `namespace`, `key` |

## Usage Example
```javascript
import { globalCacheEventManager } from '../cache/CacheEventManager.js';

// Invalidate a specific user's profile cache
await globalCacheEventManager.invalidateKey('user_profile', 'user:123');

// Subscribe to invalidation events in a cache manager
globalCacheEventManager.subscribe('user_profile', (event) => {
  console.log(`Received invalidation event: ${event.type} for key: ${event.key}`);
  // Perform local cache cleanup
});
```
