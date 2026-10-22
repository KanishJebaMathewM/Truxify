#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/truxify-rpc-recovery.XXXXXX")"
trap 'rm -rf "$RPC_HARNESS"' EXIT
mkdir -p "$RPC_HARNESS/backend/api/src/services/blockchain" "$RPC_HARNESS/backend/api/test/unit"
cp "${RPC_MANAGER_SOURCE:-$REPO_ROOT/backend/api/src/services/blockchain/rpcProviderManager.js}" "$RPC_HARNESS/backend/api/src/services/blockchain/"
cp "$REPO_ROOT/backend/api/test/unit/rpcRecoveryOwnership.test.js" "$RPC_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/test/unit/rpcProviderManager.test.js" "$RPC_HARNESS/backend/api/test/unit/"
cp "$REPO_ROOT/backend/api/eslint.config.js" "$RPC_HARNESS/backend/api/eslint.config.js"
printf '{"type":"module"}\n' > "$RPC_HARNESS/package.json"
printf "export default {test:{include:['backend/api/test/unit/*.test.js'],environment:'node'}};\n" > "$RPC_HARNESS/vitest.config.mjs"
ln -s "$REPO_ROOT/tools/rpc-recovery-tests/node_modules" "$RPC_HARNESS/node_modules"
(
 cd "$RPC_HARNESS/backend/api"
 "$REPO_ROOT/tools/rpc-recovery-tests/node_modules/.bin/eslint" --no-config-lookup --config eslint.config.js \
 src/services/blockchain/rpcProviderManager.js test/unit/rpcRecoveryOwnership.test.js
)
"$REPO_ROOT/tools/rpc-recovery-tests/node_modules/.bin/vitest" run --root "$RPC_HARNESS" --config "$RPC_HARNESS/vitest.config.mjs" "$@"
