#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
harness_dir="$(mktemp -d)"
trap 'rm -rf "$harness_dir"' EXIT
mkdir -p "$harness_dir/lib/src/services" "$harness_dir/test"
cp "$repo_root/tools/shared-websocket-tests/"pubspec.{yaml,lock} "$harness_dir/"
cp "$repo_root/packages/truxify_shared/lib/src/services/resilient_websocket.dart" "$harness_dir/lib/src/services/"
printf "%s\n" "export 'src/services/resilient_websocket.dart';" > "$harness_dir/lib/truxify_shared.dart"
for file in resilient_websocket_test websocket_attempt_lifecycle_test; do
  cp "$repo_root/packages/truxify_shared/test/$file.dart" "$harness_dir/test/"
done
cd "$harness_dir"
flutter pub get --enforce-lockfile
flutter analyze lib test
flutter test --reporter expanded
