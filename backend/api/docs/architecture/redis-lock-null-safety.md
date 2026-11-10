# Redis Lock Null Safety Architecture

## Overview
The `redisLock.js` module provides distributed locking primitives using Redis. Since Redis may not be configured in all environments (local dev, tests, degraded modes), all lock functions MUST handle a null `redisClient` gracefully.

**Issue #9427**: This document describes the null-safety guarantees implemented across all lock functions.

## The Problem

Previously, some functions in `redisLock.js` called `redisClient` methods without null checks, causing `TypeError: Cannot read property 'set' of null` when Redis was not configured.

## Null-Safety Guarantees

### 1. `acquireDistributedLock(key, ttlSeconds)`

**Behavior when `redisClient` is null:**
- ✅ Falls back to in-process per-key mutex (`acquireLocalLock`)
- ✅ Returns `{ acquired: true, release: Function }`
- ✅ No exception thrown

**Implementation:**
```javascript
const isRedisReady = redisClient &&
  (redisClient.status === 'ready' || (!redisClient.status && typeof redisClient.set === 'function'));

if (!isRedisReady) {
  return acquireLocalLock(key, ttlSeconds);
}
```

### 2. `withLock(key, fn, options)`

**Behavior when `redisClient` is null:**
- ✅ Delegates to `acquireDistributedLock` (which handles null)
- ✅ Executes `fn()` inside the local mutex
- ✅ No exception thrown (unless `fn` throws)

### 3. `acquireLock(resourceKey, ttlMs)` — Strict Mode

**Behavior when `redisClient` is null:**
- ❌ **Throws `LockAcquisitionError`**
- This is by design: strict mode requires Redis for mutual exclusion

**Why strict?** This function is used for critical operations (e.g., payment processing) where falling back to a local lock would be unsafe in a multi-instance deployment.

**Implementation:**
```javascript
if (!redisClient) {
  throw new LockAcquisitionError(
    resourceKey,
    'Redis client is not initialised — cannot guarantee mutual exclusion'
  );
}
```

### 4. `releaseLock(resourceKey, lockValue)`

**Behavior when `redisClient` is null:**
- ✅ Returns `false` (no-op)
- ✅ No exception thrown
- ✅ Safe to call in `finally` blocks

**Implementation:**
```javascript
if (!redisClient || !lockValue) return false;
```

### 5. `renewLock(resourceKey, lockValue, ttlMs)`

**Behavior when `redisClient` is null:**
- ✅ Returns `false` (no-op)
- ✅ No exception thrown

**Implementation:**
```javascript
if (!redisClient || !lockValue) return false;
```

### 6. `withLockRenewal(resourceKey, lockValue, ttlMs, asyncFn, intervalMs)`

**Behavior when `redisClient` is null:**
- ✅ Executes `asyncFn()` without renewal
- ✅ No timer started
- ✅ No exception thrown

**Implementation:**
```javascript
if (!resourceKey || !lockValue || typeof asyncFn !== 'function') {
  return asyncFn();
}
```

## Decision Matrix

| Function | `redisClient` is null | Behavior |
|----------|---------------------|----------|
| `acquireDistributedLock` | ✅ Safe | Fallback to local mutex |
| `withLock` | ✅ Safe | Uses local mutex via delegation |
| `acquireLock` | ❌ Throws | `LockAcquisitionError` (strict mode) |
| `releaseLock` | ✅ Safe | Returns `false` |
| `renewLock` | ✅ Safe | Returns `false` |
| `withLockRenewal` | ✅ Safe | Skips renewal, runs task |

## Usage Patterns

### Safe Pattern (works without Redis)
```javascript
// Uses acquireDistributedLock which has fallback
const lock = await acquireDistributedLock('my-resource', 30);
try {
  await doWork();
} finally {
  await lock.release();
}
```

### Strict Pattern (requires Redis)
```javascript
// Uses acquireLock which throws if Redis unavailable
try {
  const lockValue = await acquireLock('payment:order-123', 30000);
  if (!lockValue) {
    // Lock held by another instance, retry
    return { status: 409, message: 'Resource locked' };
  }
  try {
    await processPayment();
  } finally {
    await releaseLock('payment:order-123', lockValue);
  }
} catch (err) {
  if (err instanceof LockAcquisitionError) {
    // Redis is down - return 503
    return { status: 503, message: 'Lock service unavailable' };
  }
  throw err;
}
```

## Testing

All null-safety behaviors are tested in `backend/api/test/unit/redisLock.nullGuard.test.js`:

```bash
npm run test:unit -- backend/api/test/unit/redisLock.nullGuard.test.js
```

### Test Coverage
- ✅ `acquireDistributedLock` with null redisClient
- ✅ `withLock` with null redisClient
- ✅ `acquireLock` throws `LockAcquisitionError` when null
- ✅ `releaseLock` returns false when null
- ✅ `renewLock` returns false when null
- ✅ `withLockRenewal` executes task when null
- ✅ Empty/null lockValue handling
- ✅ Full lifecycle integration tests

## Migration Guide

If you're adding new lock functions:

1. **Always check `redisClient` at the top of the function**
2. **Decide: fallback (return safe value) or fail (throw error)?**
3. **Use `LockAcquisitionError` for strict failures**
4. **Document the behavior in this file**

### Template for New Lock Functions
```javascript
export async function myNewLockFunction(resourceKey, options) {
  // Null guard: decide behavior
  if (!redisClient) {
    // Option A: Fallback
    return { acquired: false, fallback: true };
    
    // Option B: Strict
    throw new LockAcquisitionError(resourceKey, 'Redis required');
  }
  
  // Normal implementation...
}
```

## Related Issues
- #9427 - This fix
- #14681 - Lock renewal for long-running operations
