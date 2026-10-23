#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
harness_dir="$(mktemp -d)"
trap 'rm -rf "$harness_dir"' EXIT
mkdir -p "$harness_dir/src"
cp "$repo_root/tools/zkp-http-tests/"Cargo.{toml,lock} "$harness_dir/"
cp "$repo_root/services/zkp-verifier-rust/src/main.rs" "$harness_dir/src/"
cargo test --manifest-path "$harness_dir/Cargo.toml" --locked --bin http-main
