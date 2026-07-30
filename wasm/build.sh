#!/bin/bash

echo "🚀 Building WASM module..."

# Install Rust if not installed
if ! command -v rustc &> /dev/null; then
    echo "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# Add wasm target
rustup target add wasm32-unknown-unknown

# Install wasm-pack
cargo install wasm-pack

# Build WASM module
cd rust
wasm-pack build --target nodejs --out-dir ../pkg

echo "✅ WASM module built!"