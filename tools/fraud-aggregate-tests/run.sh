#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/fraud-aggregate-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api/src/services/fraud" "$scratch/backend/api/src/config" "$scratch/backend/api/src/middleware" "$scratch/backend/api/src/lib" "$scratch/backend/api/test/unit/services/fraud" "$scratch/supabase/migrations"
cp "${FRAUD_STATS_SOURCE:-$root/backend/api/src/services/fraud/FraudDetectionService.js}" "$scratch/backend/api/src/services/fraud/FraudDetectionService.js"
cp "$root/backend/api/src/config/db.js" "$scratch/backend/api/src/config/"
cp "$root/backend/api/src/middleware/logger.js" "$scratch/backend/api/src/middleware/"
cp "$root/backend/api/src/lib/redisLock.js" "$scratch/backend/api/src/lib/"
cp "$root/backend/api/test/unit/fraudStatsAggregate.test.js" "$root/backend/api/test/unit/fraudDetectionServiceGuard.test.js" "$root/backend/api/test/unit/fraudDetectionServiceCore.test.js" "$scratch/backend/api/test/unit/"
cp "$root/backend/api/test/unit/services/fraud/FraudDetectionService.test.js" "$scratch/backend/api/test/unit/services/fraud/"
cp "$root/supabase/migrations/20260804101500_create_fraud_tables.sql" "$root/supabase/migrations/20260805000040_create_fraud_tables.sql" "$root/supabase/migrations/20261002153802_fraud_stats_aggregate.sql" "$scratch/supabase/migrations/"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
"$runner/node_modules/.bin/vitest" run test/unit/fraudStatsAggregate.test.js test/unit/fraudDetectionServiceGuard.test.js test/unit/services/fraud/FraudDetectionService.test.js
"$runner/node_modules/.bin/vitest" run test/unit/fraudDetectionServiceCore.test.js --testNamePattern "computes fraud statistics with a single aggregate correctly"
"$runner/node_modules/.bin/eslint" src/services/fraud/FraudDetectionService.js test/unit/fraudStatsAggregate.test.js test/unit/fraudDetectionServiceGuard.test.js test/unit/fraudDetectionServiceCore.test.js
