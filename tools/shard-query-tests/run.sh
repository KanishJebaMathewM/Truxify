#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/shard-query-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api/src/services/sharding" "$scratch/backend/api/src/config" "$scratch/backend/api/src/middleware" "$scratch/backend/api/test/unit"
cp "${SHARD_MANAGER_SOURCE:-$root/backend/api/src/services/sharding/ShardManager.js}" "$scratch/backend/api/src/services/sharding/ShardManager.js"
cp "$root/backend/api/src/services/sharding/ownedShardQuery.js" "$scratch/backend/api/src/services/sharding/"
cp "$root/backend/api/src/config/db.js" "$scratch/backend/api/src/config/"
cp "$root/backend/api/src/middleware/logger.js" "$scratch/backend/api/src/middleware/"
cp "$root/backend/api/test/unit/"{ShardManager,shardingParallelQuery,shardManagerPasswords,ownedShardQuery}.test.js "$scratch/backend/api/test/unit/"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
if [[ -n "${SHARD_BASELINE_PATTERN:-}" ]]; then
 "$runner/node_modules/.bin/vitest" run test/unit/ownedShardQuery.test.js --testNamePattern "$SHARD_BASELINE_PATTERN"
else
 "$runner/node_modules/.bin/vitest" run test/unit/ownedShardQuery.test.js test/unit/ShardManager.test.js test/unit/shardingParallelQuery.test.js test/unit/shardManagerPasswords.test.js
fi
"$runner/node_modules/.bin/eslint" src/services/sharding/ShardManager.js src/services/sharding/ownedShardQuery.js test/unit/ownedShardQuery.test.js test/unit/shardingParallelQuery.test.js test/unit/ShardManager.test.js
