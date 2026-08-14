#!/bin/bash
set -e

echo "Compiling WASM Geofence Polygon Triangulator..."
cargo build --target wasm32-unknown-unknown --release

echo "WASM Geofence Triangulator compiled successfully!"
