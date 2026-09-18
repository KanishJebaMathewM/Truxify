# Distributed Cache Locking Strategy

## Problem Statement
In a multi-replica Node.js environment, concurrent requests hitting the authentication middleware could trigger a "cache stampede" or race condition. 
If Request A and Request B both find a missing or invalid cache entry for a user profile simultaneously, they both query the database and attempt to write to Redis. Worse, if Request A invalidates the cache while Request B is reading it, Request B may serve stale data or bypass Role-Based Access Control (RBAC) checks.

## Solution: Redis `SET NX EX`
We implement a lightweight distributed lock using Redis atomic operations before performing any cache read/write/invalidation sequence.

```javascript
const lockKey = `lock:profile:${firebaseUid}`;
const lock = await redisClient.set(lockKey, "1", "NX", "EX", 5);
```


### Location of Change in `backend/api/src/middleware/auth.js`
Apply this patch to the `authenticate` function (around line 307 for Firebase and similarly for Supabase):

1. **Import** at the top: `import { withLock } from '../lib/redisLock.js';`
2. **Wrap** the cache read logic in `withLock`:
   ```javascript
   // OLD:
   // const cachedProfile = await getCachedProfile(firebaseUid);
   
   // NEW:
   const lockKey = `lock:profile:${firebaseUid}`;
   let cachedProfile = null;
   
   try {
     cachedProfile = await withLock(lockKey, async () => {
       const cached = await getCachedProfile(firebaseUid);
       if (cached && !isValidCachedProfile(firebaseUid, cached)) {
         await invalidateCachedProfile(firebaseUid);
         return null; // Force DB lookup
       }
       return cached;
     }, { retryDelayMs: 50, maxRetries: 2 });
   } catch (err) {
     logger.warn({ err }, 'Cache lock failed, proceeding to DB');
   }

   if (cachedProfile) {
     req.user = cachedProfile;
     return next();
   }
   // ... continue to DB query ...
```
