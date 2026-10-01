#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
harness_dir="$(mktemp -d)"
trap 'rm -rf "$harness_dir"' EXIT
mkdir -p "$harness_dir/lib/services" "$harness_dir/lib/widgets" "$harness_dir/test"
cp "$repo_root/tools/driver-pod-tests/"pubspec.{yaml,lock} "$harness_dir/"
for file in pod_storage_service pod_sync_runner pod_upload_transport background_sync_service secure_storage; do
  cp "$repo_root/apps/driver/lib/services/$file.dart" "$harness_dir/lib/services/"
done
cp "$repo_root/apps/driver/lib/widgets/pod_sync_notice.dart" "$harness_dir/lib/widgets/"
for file in pod_storage_service_test pod_retry_protocol_test background_sync_service_test pod_sync_notice_test; do
  cp "$repo_root/apps/driver/test/$file.dart" "$harness_dir/test/"
done
cd "$harness_dir"
flutter pub get --enforce-lockfile
flutter analyze lib test
flutter test --reporter expanded
