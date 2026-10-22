#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/tracker-fanout-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api"
cp -R "$root/backend/api/src" "$scratch/backend/api/"
if [[ -n "${TRACKER_FANOUT_SOURCE:-}" ]]; then
  cp "$TRACKER_FANOUT_SOURCE" "$scratch/backend/api/src/sockets/tracker.js"
fi
mkdir -p "$scratch/backend/api/test/helpers"
cp "$root/backend/api/test/trackerFanout.test.js" "$root/backend/api/test/locationEventBus.test.js" "$scratch/backend/api/test/"
cp "$root/backend/api/test/helpers/inMemoryPubSub.js" "$scratch/backend/api/test/helpers/"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
if [[ -n "${TRACKER_FANOUT_BASELINE_PATTERN:-}" ]]; then
  "$runner/node_modules/.bin/vitest" run test/trackerFanout.test.js --testNamePattern "$TRACKER_FANOUT_BASELINE_PATTERN"
else
  "$runner/node_modules/.bin/vitest" run test/trackerFanout.test.js test/locationEventBus.test.js
fi
"$runner/node_modules/.bin/eslint" src/sockets/tracker.js src/sockets/trackingFanout.js test/trackerFanout.test.js
