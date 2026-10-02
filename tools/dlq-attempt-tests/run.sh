#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/dlq-attempt-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api/src/services/webhook" "$scratch/backend/api/src/workers" "$scratch/backend/api/src/config" "$scratch/backend/api/src/middleware" "$scratch/backend/api/src/core/telemetry" "$scratch/backend/api/test/unit" "$scratch/supabase/migrations"
cp "${DLQ_ATTEMPT_SOURCE:-$root/backend/api/src/services/webhook/dlqService.js}" "$scratch/backend/api/src/services/webhook/dlqService.js"
cp "$root/backend/api/src/workers/dlqWorker.js" "$scratch/backend/api/src/workers/"
printf 'export const processEscrowWebhookEvent = async () => {};\n' > "$scratch/backend/api/src/services/webhook/escrowWebhookProcessor.js"
cp "$root/backend/api/src/config/db.js" "$scratch/backend/api/src/config/"
cp "$root/backend/api/src/middleware/logger.js" "$scratch/backend/api/src/middleware/"
cp "$root/backend/api/src/core/telemetry/WorkerTracer.js" "$scratch/backend/api/src/core/telemetry/"
cp "$root/backend/api/test/unit/dlqService.test.js" "$root/backend/api/test/unit/dlqWorker.test.js" "$runner/fixtures/dlqAttemptProtocol.test.js" "$scratch/backend/api/test/unit/"
cp "$root/supabase/migrations/20260710000000_create_webhook_failures.sql" "$root/supabase/migrations/20260807000000_make_webhook_dlq_crash_safe.sql" "$root/supabase/migrations/20261002164243_webhook_dlq_attempt_fencing.sql" "$scratch/supabase/migrations/"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
if [[ -n "${DLQ_BASELINE_PATTERN:-}" ]]; then
  "$runner/node_modules/.bin/vitest" run test/unit/dlqAttemptProtocol.test.js --testNamePattern "$DLQ_BASELINE_PATTERN"
else
  "$runner/node_modules/.bin/vitest" run test/unit/dlqService.test.js test/unit/dlqWorker.test.js test/unit/dlqAttemptProtocol.test.js
fi
"$runner/node_modules/.bin/eslint" src/services/webhook/dlqService.js test/unit/dlqService.test.js test/unit/dlqAttemptProtocol.test.js
