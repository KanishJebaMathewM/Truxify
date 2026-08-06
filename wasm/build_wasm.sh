#!/bin/bash
set -e

echo "Building WASM / WASI Offline Routing Binary..."
cargo build --target wasm32-unknown-unknown --release

if command -v wasm-bindgen &> /dev/null
then
    wasm-bindgen target/wasm32-unknown-unknown/release/truxify_wasm_routing.wasm --out-dir ./pkg --target web
    echo "WASM target built successfully in ./pkg"
else
    echo "wasm-bindgen not found. Output saved to target/wasm32-unknown-unknown/release/truxify_wasm_routing.wasm"
fi
