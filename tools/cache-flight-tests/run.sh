#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/truxify-cache-flight.XXXXXX")"
trap 'rm -rf "$CACHE_HARNESS"' EXIT
mkdir -p "$CACHE_HARNESS/backend/api/src/lib/cache" \
  "$CACHE_HARNESS/backend/api/src/config" "$CACHE_HARNESS/backend/api/src/middleware" \
  "$CACHE_HARNESS/backend/api/test/unit/cache"
cp "$REPO_ROOT"/backend/api/src/lib/cache/*.js "$CACHE_HARNESS/backend/api/src/lib/cache/"
cp "$REPO_ROOT/backend/api/src/lib/lruCache.js" "$REPO_ROOT/backend/api/src/lib/redisLock.js" "$CACHE_HARNESS/backend/api/src/lib/"
cp "$REPO_ROOT/backend/api/src/config/db.js" "$CACHE_HARNESS/backend/api/src/config/"
cp "$REPO_ROOT/backend/api/src/middleware/logger.js" "$CACHE_HARNESS/backend/api/src/middleware/"
cp "$REPO_ROOT/backend/api/test/unit/cache/cacheFlightLifecycle.test.js" "$CACHE_HARNESS/backend/api/test/unit/cache/"
printf '{"type":"module"}\n' > "$CACHE_HARNESS/package.json"
printf "export default {test:{include:['backend/api/test/unit/cache/cacheFlightLifecycle.test.js'],environment:'node'}};\n" > "$CACHE_HARNESS/vitest.config.mjs"
ln -s "$REPO_ROOT/tools/cache-flight-tests/node_modules" "$CACHE_HARNESS/node_modules"
"$REPO_ROOT/tools/cache-flight-tests/node_modules/.bin/vitest" run --root "$CACHE_HARNESS" --config "$CACHE_HARNESS/vitest.config.mjs"
