# ⚡ Truxify C++ High-Speed Route & Tariff Matrix Engine

This directory contains the **C++17 High-Speed Matrix Solver Engine** designed to compute $N \times N$ distance, travel duration, and freight tariff matrices for thousands of route pairs with microsecond performance.

---

## ⚡ Performance Features

- **C++17 Native Speed**: Microsecond matrix solving using SIMD vectorization and native double-precision floating point Haversine math.
- **Multithreaded Calculations**: Parallelized across available CPU cores for large fleet batch matrix operations.

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t truxify-matrix-cpp services/route-matrix-cpp/

# Run container
docker run -p 8086:8086 truxify-matrix-cpp
```
