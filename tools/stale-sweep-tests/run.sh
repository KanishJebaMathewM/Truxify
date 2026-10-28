#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$root/tools/stale-sweep-tests"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/backend/api/src/workers" "$scratch/backend/api/src/config" "$scratch/backend/api/src/middleware" "$scratch/backend/api/src/services" "$scratch/backend/api/src/core/telemetry" "$scratch/backend/api/src/repositories" "$scratch/backend/api/test/unit"
cp "${STALE_WORKER_SOURCE:-$root/backend/api/src/workers/staleOrderWorker.js}" "$scratch/backend/api/src/workers/staleOrderWorker.js"
cp "$root"/backend/api/test/unit/staleOrderWorker*.test.js "$scratch/backend/api/test/unit/"
# External imports are controlled; the actual worker and its cancellation path run unchanged.
printf 'export const supabase={},supabaseAdmin={},redisClient=null;\n' > "$scratch/backend/api/src/config/db.js"
printf 'export default {info(){},warn(){},error(){}};\n' > "$scratch/backend/api/src/middleware/logger.js"
printf 'export async function sendPushNotification(){throw new Error("Unmocked notification boundary");}\n' > "$scratch/backend/api/src/services/notificationService.js"
printf 'export async function submitEscrowRefund(){throw new Error("Unmocked escrow boundary");} export const confirmEscrowRefund=submitEscrowRefund;\n' > "$scratch/backend/api/src/services/escrow.js"
printf 'export const WorkerTracer={wrapCronJob:(_n,fn)=>fn};\n' > "$scratch/backend/api/src/core/telemetry/WorkerTracer.js"
printf 'export default {getActiveSpan(){return null;}};\n' > "$scratch/backend/api/src/core/telemetry/SpanFactory.js"
printf 'export class OrderRepository {}\n' > "$scratch/backend/api/src/repositories/orderRepository.js"
cp "$root/backend/api/eslint.config.js" "$scratch/backend/api/"
printf '{"type":"module"}\n' > "$scratch/package.json"
ln -s "$runner/node_modules" "$scratch/node_modules"
cd "$scratch/backend/api"
export STALE_NATIVE_REDIS=1
"$runner/node_modules/.bin/vitest" run test/unit/staleOrderWorker*.test.js "$@"
"$runner/node_modules/.bin/eslint" src/workers/staleOrderWorker.js test/unit/staleOrderWorkerLease.test.js test/unit/staleOrderWorkerNativeLease.test.js test/unit/staleOrderWorkerConcurrency.test.js test/unit/staleOrderWorkerNotifications.test.js test/unit/staleOrderWorkerRace.test.js --max-warnings=0
