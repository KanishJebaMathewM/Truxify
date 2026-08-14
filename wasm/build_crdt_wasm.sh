#!/bin/bash
set -e

echo "Compiling WASM LWW-CRDT State Merger..."
cargo build --target wasm32-unknown-unknown --release

echo "WASM CRDT Engine compiled successfully!"
