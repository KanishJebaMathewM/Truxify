#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/osrm-budget-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api/src/services/routing" "$scratch/backend/api/src/config" "$scratch/backend/api/src/middleware" "$scratch/backend/api/src/core" "$scratch/backend/api/test/unit"
cp "${OSRM_BUDGET_SOURCE:-$root/backend/api/src/services/osrm.js}" "$scratch/backend/api/src/services/osrm.js"
cp "$root/backend/api/src/services/routing/routingBudget.js" "$scratch/backend/api/src/services/routing/"
cp "$root/backend/api/src/config/db.js" "$scratch/backend/api/src/config/"
cp "$root/backend/api/src/middleware/logger.js" "$scratch/backend/api/src/middleware/"
cp "$root/backend/api/src/core/performanceMetrics.js" "$scratch/backend/api/src/core/"
cp "$root/backend/api/test/unit/osrm.test.js" "$root/backend/api/test/unit/osrmBudgetLifecycle.test.js" "$scratch/backend/api/test/unit/"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
if [[ -n "${OSRM_BASELINE_PATTERN:-}" ]]; then
  "$runner/node_modules/.bin/vitest" run test/unit/osrmBudgetLifecycle.test.js --testNamePattern "$OSRM_BASELINE_PATTERN" --testTimeout 500
else
  "$runner/node_modules/.bin/vitest" run test/unit/osrm.test.js test/unit/osrmBudgetLifecycle.test.js
fi
"$runner/node_modules/.bin/eslint" src/services/osrm.js src/services/routing/routingBudget.js test/unit/osrmBudgetLifecycle.test.js
