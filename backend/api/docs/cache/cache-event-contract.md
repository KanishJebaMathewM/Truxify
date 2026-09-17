# Cache Event Validation Contract

## Overview
The `createCacheEvent` factory function enforces strict validation on event creation to prevent malformed events from entering the cache invalidation pipeline. This document describes the contract and provides examples of valid and invalid usage.

**Issue #9898 Context**: The validation contract was tightened to require explicit arguments for each event type. Tests using the old "optional args" API began failing with `TypeError`. This document serves as the canonical reference for the new contract.

## Event Types

### 1. INVALIDATE_KEY
Invalidates a specific cache key within a namespace.

**Required Options:**
```javascript
{
  namespace: string,  // Non-empty string
  key: string         // Non-empty string (the exact cache key)
}
```

**Valid Example:**
```javascript
const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
  namespace: 'users',
  key: 'user:123:profile'
});
```

**Invalid Examples (will throw):**
```javascript
// Missing key
createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'users' });
// ❌ TypeError: Option "key" is required

// Empty key
createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'users', key: '' });
// ❌ TypeError: Option "key" is required

// Whitespace-only key
createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'users', key: '   ' });
// ❌ TypeError: Option "key" is required
```

### 2. INVALIDATE_PATTERN
Invalidates all cache keys matching a glob pattern within a namespace.

**Required Options:**
```javascript
{
  namespace: string,  // Non-empty string
  pattern: string     // Non-empty string (glob pattern, e.g., 'user:*')
}
```

**Valid Example:**
```javascript
const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
  namespace: 'users',
  pattern: 'user:*:preferences'
});
```

**Invalid Examples (will throw):**
```javascript
// Missing pattern
createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'users' });
// ❌ TypeError: Option "pattern" is required

// Regex instead of string
createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { 
  namespace: 'users', 
  pattern: /user:.*/ 
});
// ❌ TypeError: Option "pattern" is required and must be a non-empty string
```

### 3. BUMP_VERSION
Bumps the cache version for an entire namespace, invalidating all keys at once.

**Required Options:**
```javascript
{
  namespace: string   // Non-empty string
}
```

**Valid Example:**
```javascript
const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
  namespace: 'users'
});
```

**Invalid Examples (will throw):**
```javascript
// Missing namespace
createCacheEvent(CacheEventType.BUMP_VERSION, {});
// ❌ TypeError: Option "namespace" is required

// Empty namespace
createCacheEvent(CacheEventType.BUMP_VERSION, { namespace: '' });
// ❌ TypeError: Option "namespace" is required
```

## Universal Validation Rules

### Namespace
- **Always required** for all event types
- Must be a non-empty string (after trimming whitespace)
- Cannot be null, undefined, or a non-string type

### Timestamp
- **Always optional**
- If not provided, defaults to `Date.now()`
- If provided, must be a number

### Metadata
- **Always optional**
- Can be any object (used for tracing, debugging)
- Preserved on the resulting event object

## Event Object Structure

All events returned by `createCacheEvent` have this shape:

```typescript
interface CacheEvent {
  id: string;                          // Unique event ID (UUID)
  type: CacheEventType;                // The event type enum
  namespace: string;                   // Always present
  key?: string;                        // Only for INVALIDATE_KEY
  pattern?: string;                    // Only for INVALIDATE_PATTERN
  timestamp: number;                   // Unix ms timestamp
  metadata?: Record<string, unknown>;  // Optional metadata
}
```

## Common Pitfalls (From #9898)

### ❌ Old API (broken)
```javascript
// Assumed key was optional
const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, { 
  namespace: 'users' 
});
// TypeError: Option "key" is required
```

### ❌ Expected null/undefined fields
```javascript
const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
  namespace: 'users',
  key: 'user:123'
});
expect(event.key).toBeNull(); // WRONG - key is 'user:123'
```

### ❌ Missing namespace for BUMP_VERSION
```javascript
const event = createCacheEvent(CacheEventType.BUMP_VERSION);
// TypeError: Option "namespace" is required
```

### ✅ Corrected API
```javascript
const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, { 
  namespace: 'users', 
  key: 'user:123' 
});
expect(event.key).toBe('user:123');
expect(event.namespace).toBe('users');
```

## Migration Guide

If your tests or code use `createCacheEvent`, verify each call site:

1. **INVALIDATE_KEY calls**: Ensure both `namespace` AND `key` are provided
2. **INVALIDATE_PATTERN calls**: Ensure both `namespace` AND `pattern` are provided
3. **BUMP_VERSION calls**: Ensure `namespace` is provided
4. **Assertions**: Do not assert that optional fields are `null` - they are simply omitted from the call

### Before (broken)
```javascript
it('should allow missing key', () => {
  const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'ns' });
  expect(event.key).toBeNull(); // Wrong expectation
});
```

### After (correct)
```javascript
it('should require key', () => {
  expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'ns' }))
    .toThrow('key');
});

it('should include key when provided', () => {
  const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, { 
    namespace: 'ns', 
    key: 'my-key' 
  });
  expect(event.key).toBe('my-key');
});
```

## Testing Utilities

Use the fixtures in `backend/api/test/helpers/cacheEventFixtures.js`:

```javascript
import { 
  createValidOpts, 
  VALID_INVALIDATE_KEY_OPTS 
} from '../helpers/cacheEventFixtures.js';

it('should create valid event', () => {
  const event = createCacheEvent(
    CacheEventType.INVALIDATE_KEY, 
    VALID_INVALIDATE_KEY_OPTS
  );
  expect(event.key).toBe('user:123');
});

it('should accept overrides', () => {
  const opts = createValidOpts.invalidateKey({ key: 'custom-key' });
  const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, opts);
  expect(event.key).toBe('custom-key');
});
```

## Production Call Sites (Compliant)

All production code already complies with the new contract:
- `src/cache/CacheInvalidator.js:148-151`
- `src/cache/CacheInvalidator.js:182-185`
- `src/cache/CacheInvalidator.js:235-239`
- `src/lib/profileCache.js:263-266`
- `src/lib/profileCache.js:341-344`

## Rationale

The stricter validation prevents:
1. **Silent failures**: Malformed events that do nothing but appear successful
2. **Cache corruption**: Events that target the wrong namespace/key
3. **Debugging difficulty**: Null/undefined fields that hide the real issue
4. **Type drift**: Tests that pass but don't actually test the intended behavior

By throwing immediately on invalid input, bugs are caught at creation time rather than during event processing.

