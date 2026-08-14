#!/bin/bash
set -e

echo "Compiling WASM Contraction Hierarchy Router..."
cargo build --target wasm32-unknown-unknown --release

echo "WASM Route Solver compiled successfully!"
