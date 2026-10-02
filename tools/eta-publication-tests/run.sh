#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/eta-publication-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api/src/services/order" "$scratch/backend/api/src/repositories" "$scratch/backend/api/src/config" "$scratch/backend/api/src/middleware" "$scratch/backend/api/src/sockets" "$scratch/backend/api/src/core/telemetry" "$scratch/backend/api/src/lib" "$scratch/backend/api/src/utils" "$scratch/backend/api/test/unit" "$scratch/supabase/migrations"
cp "${ETA_SERVICE_SOURCE:-$root/backend/api/src/services/order/etaService.js}" "$scratch/backend/api/src/services/order/etaService.js"
cp "$root/backend/api/src/repositories/orderRepository.js" "$scratch/backend/api/src/repositories/"
for path in config/db.js middleware/logger.js core/telemetry/SpanFactory.js; do
  cp "$root/backend/api/src/$path" "$scratch/backend/api/src/$path"
done
# Import seams only: no source extraction or rewritten production function bodies.
for path in core/retry.js core/performanceMetrics.js lib/requestContext.js utils/pagination.js services/osrm.js services/trafficService.js services/routingService.js sockets/tracker.js sockets/locationServer.js; do
  printf 'export {};\n' > "$scratch/backend/api/src/$path"
done
cp "$root/backend/api/test/unit/orderRepository.test.js" "$runner/fixtures/etaPublication.test.js" "$scratch/backend/api/test/unit/"
cp "$runner/setup.js" "$scratch/backend/api/test/setup.js"
cp "$root/supabase/migrations/20261002174206_eta_calculation_generation.sql" "$scratch/supabase/migrations/"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
printf "export default { test: { setupFiles: ['./test/setup.js'] } };\n" > vitest.config.js
if [[ -n "${ETA_BASELINE_PATTERN:-}" ]]; then
  "$runner/node_modules/.bin/vitest" run test/unit/etaPublication.test.js --config vitest.config.js --testNamePattern "$ETA_BASELINE_PATTERN"
else
  "$runner/node_modules/.bin/vitest" run test/unit/etaPublication.test.js test/unit/orderRepository.test.js --config vitest.config.js
fi
"$runner/node_modules/.bin/eslint" src/services/order/etaService.js src/repositories/orderRepository.js test/unit/etaPublication.test.js
