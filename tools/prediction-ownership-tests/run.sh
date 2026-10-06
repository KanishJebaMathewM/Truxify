#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PREDICTION_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/truxify-prediction-ownership.XXXXXX")"
trap 'rm -rf "$PREDICTION_HARNESS"' EXIT
mkdir -p "$PREDICTION_HARNESS/backend/api/src/services" "$PREDICTION_HARNESS/backend/api/src/lib" \
 "$PREDICTION_HARNESS/backend/api/src/utils" "$PREDICTION_HARNESS/backend/api/src/middleware" \
 "$PREDICTION_HARNESS/backend/api/test/unit"
cp "${PREDICTION_SERVICE_SOURCE:-$REPO_ROOT/backend/api/src/services/ml.js}" "$PREDICTION_HARNESS/backend/api/src/services/ml.js"
cp "$REPO_ROOT/backend/api/src/lib/ownedPredictionFlights.js" "$REPO_ROOT/backend/api/src/lib/predictionValidator.js" "$PREDICTION_HARNESS/backend/api/src/lib/"
cp "$REPO_ROOT/backend/api/src/services/mlMatchingGateway.js" "$PREDICTION_HARNESS/backend/api/src/services/"
cp "$REPO_ROOT/backend/api/src/utils/cache.js" "$PREDICTION_HARNESS/backend/api/src/utils/"
cp "$REPO_ROOT/backend/api/src/middleware/logger.js" "$PREDICTION_HARNESS/backend/api/src/middleware/"
cp "$REPO_ROOT/backend/api/test/unit/cachedPredictionOwnership.test.js" "$REPO_ROOT/backend/api/test/unit/mlService.test.js" "$PREDICTION_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/eslint.config.js" "$PREDICTION_HARNESS/backend/api/eslint.config.js"
printf '{"type":"module"}\n' > "$PREDICTION_HARNESS/package.json"
printf "export default {test:{include:['backend/api/test/unit/*.test.js'],environment:'node',setupFiles:['./setup.mjs'],testTimeout:15000}};\n" > "$PREDICTION_HARNESS/vitest.config.mjs"
printf "import {vi} from 'vitest'; vi.mock('./backend/api/src/middleware/logger.js',()=>({default:{warn:vi.fn(),error:vi.fn(),debug:vi.fn(),info:vi.fn()}}));\n" > "$PREDICTION_HARNESS/setup.mjs"
ln -s "$REPO_ROOT/tools/prediction-ownership-tests/node_modules" "$PREDICTION_HARNESS/node_modules"
(
 cd "$PREDICTION_HARNESS/backend/api"
 "$REPO_ROOT/tools/prediction-ownership-tests/node_modules/.bin/eslint" --no-config-lookup --config eslint.config.js \
 src/services/ml.js src/lib/ownedPredictionFlights.js test/unit/cachedPredictionOwnership.test.js
)
node --check "$PREDICTION_HARNESS/backend/api/src/services/ml.js"
node --check "$PREDICTION_HARNESS/backend/api/src/lib/ownedPredictionFlights.js"
"$REPO_ROOT/tools/prediction-ownership-tests/node_modules/.bin/vitest" run --root "$PREDICTION_HARNESS" --config "$PREDICTION_HARNESS/vitest.config.mjs" "$@"
