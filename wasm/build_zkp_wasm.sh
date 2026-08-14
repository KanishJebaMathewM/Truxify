#!/bin/bash
set -e

echo "Building WASM ZKP Edge Verifier..."
cargo build --target wasm32-unknown-unknown --release

echo "WASM ZKP Edge Verifier compiled successfully!"
