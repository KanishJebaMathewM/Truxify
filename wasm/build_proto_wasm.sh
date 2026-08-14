#!/bin/bash
set -e

echo "Compiling WASM Zero-Copy Protobuf Parser..."
cargo build --target wasm32-unknown-unknown --release

echo "WASM Protobuf Parser compiled successfully!"
