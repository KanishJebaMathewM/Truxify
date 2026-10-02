#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/relay-corridor-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api/src/services/order" "$scratch/backend/api/src/middleware" "$scratch/backend/api/src/controllers" "$scratch/backend/api/test/unit"
cp "${RELAY_PLANNER_SOURCE:-$root/backend/api/src/services/relayDispatchService.js}" "$scratch/backend/api/src/services/relayDispatchService.js"
cp "${RELAY_CONTROLLER_SOURCE:-$root/backend/api/src/controllers/relayController.js}" "$scratch/backend/api/src/controllers/relayController.js"
cp "$root/backend/api/src/services/relayHandshakeService.js" "$scratch/backend/api/src/services/"
cp "$root/backend/api/src/services/order/domainError.js" "$scratch/backend/api/src/services/order/"
# Control only logging; planner, controller, DomainError and handshake imports are actual modules.
printf 'export default {info(){},warn(){},error(){}};\n' > "$scratch/backend/api/src/middleware/logger.js"
cp "$root/backend/api/test/unit/relayCorridorPlanning.test.js" "$scratch/backend/api/test/unit/"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
"$runner/node_modules/.bin/vitest" run test/unit/relayCorridorPlanning.test.js --testNamePattern="${RELAY_TEST_PATTERN:-.*}"
"$runner/node_modules/.bin/eslint" src/services/relayDispatchService.js src/controllers/relayController.js test/unit/relayCorridorPlanning.test.js --max-warnings=0
