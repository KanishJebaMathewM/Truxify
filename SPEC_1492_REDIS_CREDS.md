# Implementation Specification: Issue #1492 - Remove Hardcoded Redis Credentials

## Problem
Upstash Redis credentials embedded as const strings in Flutter source, compiled into release APK.

## Implementation Details

**File: `apps/driver/lib/config/redis_config.dart`** (replace)

REMOVE this:
```dart
const String REDIS_URL = 'https://...';
const String REDIS_TOKEN = 'AeyAAI...';
```

REPLACE with:
```dart
class RedisConfig {
  static String getRedisUrl() {
    // Empty - Redis accessed via backend only
    return '';
  }
}
```

**File: `backend/api/src/services/redis.service.js`** (modify)

Use environment variables:
```javascript
const redis = require('redis');

const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  url: process.env.UPSTASH_REDIS_REST_URL,
});
```

**File: `.env.example`**

Add:
```
UPSTASH_REDIS_REST_URL=https://...
REDIS_HOST=...
REDIS_PORT=...
REDIS_PASSWORD=...
```

### Changes
1. Remove all hardcoded Redis constants from Flutter
2. All Redis operations go through backend API endpoints
3. Backend accesses Redis using environment variables
4. Update documentation: CONTRIBUTING.md

## Closes #1492
