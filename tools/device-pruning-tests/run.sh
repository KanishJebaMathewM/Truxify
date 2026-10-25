#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEVICE_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/truxify-device-pruning.XXXXXX")"
trap 'rm -rf "$DEVICE_HARNESS"' EXIT
mkdir -p "$DEVICE_HARNESS/backend/api/src/workers" "$DEVICE_HARNESS/backend/api/src/config" \
 "$DEVICE_HARNESS/backend/api/src/middleware" "$DEVICE_HARNESS/backend/api/src/core/telemetry" \
 "$DEVICE_HARNESS/backend/api/test/unit" "$DEVICE_HARNESS/backend/api/test/helpers"
cp "${DEVICE_PRUNING_SOURCE:-$REPO_ROOT/backend/api/src/workers/devicePruningWorker.js}" "$DEVICE_HARNESS/backend/api/src/workers/devicePruningWorker.js"
cp "$REPO_ROOT/backend/api/src/config/db.js" "$DEVICE_HARNESS/backend/api/src/config/"
cp "$REPO_ROOT/backend/api/src/middleware/logger.js" "$DEVICE_HARNESS/backend/api/src/middleware/"
cp "$REPO_ROOT/backend/api/src/core/telemetry/WorkerTracer.js" "$DEVICE_HARNESS/backend/api/src/core/telemetry/"
cp "$REPO_ROOT/backend/api/test/unit/devicePruningWorker.test.js" "$REPO_ROOT/backend/api/test/unit/devicePruningLifecycle.test.js" "$DEVICE_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/test/helpers/supabaseMock.js" "$DEVICE_HARNESS/backend/api/test/helpers/"
cp "$REPO_ROOT/backend/api/eslint.config.js" "$DEVICE_HARNESS/backend/api/eslint.config.js"
printf '{"type":"module"}\n' > "$DEVICE_HARNESS/package.json"
printf "export default {test:{include:['backend/api/test/unit/devicePruning*.test.js'],environment:'node',testTimeout:15000}};\n" > "$DEVICE_HARNESS/vitest.config.mjs"
ln -s "$REPO_ROOT/tools/device-pruning-tests/node_modules" "$DEVICE_HARNESS/node_modules"
(
  cd "$DEVICE_HARNESS/backend/api"
  "$REPO_ROOT/tools/device-pruning-tests/node_modules/.bin/eslint" --no-config-lookup --config eslint.config.js \
    src/workers/devicePruningWorker.js test/unit/devicePruningWorker.test.js test/unit/devicePruningLifecycle.test.js
)
node --check "$DEVICE_HARNESS/backend/api/src/workers/devicePruningWorker.js"
"$REPO_ROOT/tools/device-pruning-tests/node_modules/.bin/vitest" run --root "$DEVICE_HARNESS" --config "$DEVICE_HARNESS/vitest.config.mjs"
