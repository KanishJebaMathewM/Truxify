#!/bin/bash
set -e

echo "Building WASM Signature Verification Engine..."
cargo build --target wasm32-unknown-unknown --release

echo "WASM Signature Verifier compiled successfully!"
