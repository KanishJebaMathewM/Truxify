# ⚡ Truxify C++20 SIMD Vector Embedding Matcher Engine

This directory contains the **C++20 High-Speed Vector Matcher Engine** designed to perform real-time Cosine Similarity KNN searches across 100,000+ driver latent embeddings with sub-millisecond ($< 1\text{ ms}$) latency.

---

## ⚡ Key Technical Innovations

- **C++20 Native Performance**: SIMD parallelized inner-product and cosine vector math across 64-dimensional latent embedding spaces.
- **Top-K Partial Sort**: Sub-millisecond $O(N \log K)$ selection of optimal drivers matching shipper load requirements.
- **High Concurrency**: Thread-safe memory allocation designed for 100,000+ driver queries per second.

---

## 🐳 Docker Deployment

```bash
# Build container image
docker build -t truxify-vector-cpp services/vector-matcher-cpp/

# Run container
docker run -p 8088:8088 truxify-vector-cpp
```
