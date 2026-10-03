#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
runner="$root/tools/fcm-lifecycle-tests"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/backend/api/src/services/order" "$fixture/backend/api/src/config" "$fixture/backend/api/src/middleware" "$fixture/backend/api/src/lib" "$fixture/backend/api/src/core" "$fixture/backend/api/test/unit" "$fixture/supabase/migrations"
cp "${FCM_BASELINE_SOURCE:-$root/backend/api/src/services/notificationService.js}" "$fixture/backend/api/src/services/notificationService.js"
cp "$root/backend/api/src/services/order/domainError.js" "$fixture/backend/api/src/services/order/"
cp "$runner/fixtures/fcmLifecycle.test.js" "$fixture/backend/api/test/unit/"
cp "$root/backend/api/eslint.config.js" "$fixture/backend/api/"
cp "$root/supabase/migrations/20261003034625_fcm_lifecycle_snapshot.sql" "$fixture/supabase/migrations/"
for file in config/db.js middleware/logger.js lib/otpHashing.js core/performanceMetrics.js; do printf '%s\n' 'export {};' > "$fixture/backend/api/src/$file"; done
printf '%s\n' '{"type":"module"}' > "$fixture/backend/api/package.json"
ln -s "$runner/node_modules" "$fixture/backend/api/node_modules"
cd "$fixture/backend/api"
"$runner/node_modules/.bin/vitest" run test/unit/fcmLifecycle.test.js "$@"
"$runner/node_modules/.bin/eslint" src/services/notificationService.js test/unit/fcmLifecycle.test.js --max-warnings 0
