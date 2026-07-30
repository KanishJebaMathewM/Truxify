# 🌐 WebAssembly System Interface (WASI) Sandbox Runtime

This directory contains the **WASI Execution Runtime** for sandboxed, secure execution of third-party plugins, custom driver scoring modules, and untrusted extension code in Truxify.

---

## 📐 Directory Structure

```text
wasi/
├── wasi-runtime.js       # Node.js WASI module runner & memory sandbox wrapper
├── routes.js             # Express API endpoints for WASI module lifecycle
├── package.json          # Dependency definitions
└── src/                  # C/Rust WASI source files and compiled .wasm binaries
```

---

## ⚡ Architecture & Security Features

- **Sandboxed Execution**: WASI modules execute in an isolated WebAssembly memory sandbox with zero capability access to filesystem or sockets unless explicitly granted.
- **Resource Limits**: Strict memory limits (default `64MB`) and execution timeout enforcement per invocation.
- **Capability-Based Security**: File descriptors and environment variables are pre-opened using fine-grained WASI capabilities.

---

## 🔌 API Endpoints (`routes.js`)

| Endpoint | Method | Limiter | Description |
| :--- | :--- | :--- | :--- |
| `/wasi/load` | `POST` | `wasiActionLimiter` | Loads a compiled `.wasm` module into the WASI runtime and returns an `instanceId`. |
| `/wasi/execute` | `POST` | `wasiActionLimiter` | Executes a function on an active WASI instance with input parameters. |
| `/wasi/unload/:instanceId` | `DELETE` | `wasiActionLimiter` | Terminates and cleans up WASI instance memory resources. |
| `/wasi/instances` | `GET` | — | Lists active WASI module instances and memory statistics. |
