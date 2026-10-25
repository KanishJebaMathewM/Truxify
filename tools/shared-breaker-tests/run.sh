#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
runner="$root/tools/shared-breaker-tests"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/src/lib" "$fixture/src/middleware" "$fixture/test/unit"
cp "${BREAKER_BASELINE_SOURCE:-$root/backend/api/src/lib/circuitBreaker.js}" "$fixture/src/lib/circuitBreaker.js"
printf '%s\n' 'export default {info(){},warn(){},error(){}};' > "$fixture/src/middleware/logger.js"
cp "$runner/fixtures/sharedBreaker.test.js" "$fixture/test/unit/"
cp "$root/backend/api/test/unit/circuitBreaker.test.js" "$fixture/test/unit/"
printf '%s\n' '{"type":"module"}' > "$fixture/package.json"
ln -s "$runner/node_modules" "$fixture/node_modules"
cd "$fixture"
"$runner/node_modules/.bin/vitest" run test/unit/sharedBreaker.test.js test/unit/circuitBreaker.test.js "$@"
"$runner/node_modules/.bin/eslint" --no-config-lookup --config "$runner/eslint.config.js" src/lib/circuitBreaker.js test/unit/sharedBreaker.test.js --max-warnings 0
