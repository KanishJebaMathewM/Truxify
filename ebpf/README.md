# 🛡️ eBPF Kernel Tracing & Network Security Subsystem

This directory contains the **Extended Berkeley Packet Filter (eBPF)** kernel observability, network monitoring, and system call tracing infrastructure for the Truxify logistics platform.

---

## 📐 Subsystem Architecture

```text
ebpf/
├── loader.py             # Python eBPF program compiler & loader (BCC / libbpf)
├── routes.js             # Express REST API routes for eBPF metrics & actions
├── requirements.txt      # BCC / Python dependencies
├── package.json          # Express middleware definition
├── programs/
│   ├── trace_network.c   # Kernel TCP/IP latency & throughput socket tracer
│   ├── trace_security.c  # Anomaly & unauthorized process execution tracer
│   └── trace_syscalls.c # System call frequency & latency profiler
```

---

## ⚡ Key Components & C Programs

| C Program | Scope | Purpose |
| :--- | :--- | :--- |
| [`trace_network.c`](./programs/trace_network.c) | Network | Hooks into `tcp_v4_connect` and `tcp_v6_connect` to track socket latency, connection counts, and packet drops per container. |
| [`trace_security.c`](./programs/trace_security.c) | Security | Hooks into `sys_enter_execve` to detect unexpected process execution or privilege escalation inside container boundaries. |
| [`trace_syscalls.c`](./programs/trace_syscalls.c) | System Calls | Monitors frequency and duration of system calls across microservices for zero-day threat detection and performance profiling. |

---

## 🔌 API Endpoints (`routes.js`)

All eBPF endpoints are rate-limited and protected.

| Endpoint | Method | Limiter | Description |
| :--- | :--- | :--- | :--- |
| `/api/ebpf/load` | `POST` | Strict (`5 req / 15m`) | Compiles and loads an eBPF program into the Linux kernel. |
| `/api/ebpf/unload` | `POST` | Strict (`5 req / 15m`) | Detaches and unloads a active eBPF kernel hook. |
| `/api/ebpf/metrics` | `GET` | Moderate (`100 req / 15m`) | Fetches real-time eBPF ring buffer metrics and event statistics. |
| `/api/ebpf/status` | `GET` | Moderate (`100 req / 15m`) | Returns loaded kernel probes, attach points, and active maps. |

---

## 🚀 Running eBPF Locally

> **Note**: eBPF requires Linux kernel headers (`>= 5.4`) and root/`CAP_BPF` privileges.

```bash
# Start eBPF loader service
python3 loader.py --program programs/trace_network.c
```
