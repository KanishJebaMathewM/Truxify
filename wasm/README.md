# ⚡ Edge WebAssembly (WASM) Routing & Calculation Engine

This directory contains the **Edge WebAssembly Engine** written in Rust and compiled to WebAssembly for ultra-fast, microsecond-level route distance calculation, fuel consumption estimation, and freight tariff calculations.

---

## 📐 Directory Structure

```text
wasm/
├── edge-runtime.js       # High-performance Node.js WASM bridge & instance pool
├── routes.js             # Express API endpoints for WASM edge calculations
├── build.sh              # Rust to WASM (`wasm-pack` / `cargo build --target wasm32-unknown-unknown`) build script
├── package.json          # Module manifest
└── rust/                 # Rust source code for route & tariff algorithms
```

---

## 🚀 Performance Highlights

- **Near-Native Speed**: Written in Rust and compiled to WebAssembly for sub-millisecond execution times.
- **Zero-Copy Memory Buffers**: ArrayBuffers shared between Node.js V8 runtime and WebAssembly linear memory.
- **Edge Compatible**: Deployable to edge networks (Cloudflare Workers / Fastly Compute@Edge).

---

## 🔌 API Endpoints (`routes.js`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/wasm/route` | `POST` | Calculates high-speed route distance, duration, and toll estimations. |
| `/wasm/tariff` | `POST` | Computes complex multi-slab freight tariff prices based on weight and distance. |
| `/wasm/health` | `GET` | Returns WASM module load status and memory usage metrics. |
