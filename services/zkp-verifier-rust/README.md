# 🔐 Truxify Rust Zero-Knowledge Proof (ZKP) Verifier Microservice

This directory contains the **Rust Zero-Knowledge Proof (ZKP) Verifier Engine** for high-security, privacy-preserving verification of driver identity, proof-of-funds, and location geofence compliance without exposing underlying PII data.

---

## 🔒 Security & Performance Features

- **Rust Memory Safety**: Zero data races and guaranteed memory safety for sensitive cryptographic verification circuits.
- **Microsecond Proof Verification**: Evaluates SHA-256 and Poseidon proof circuit hashes in sub-millisecond execution times.
- **Privacy-Preserving KYC**: Validates driver rating, license status, and wallet solvency without revealing actual identity or account balances.

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t truxify-zkp-rust services/zkp-verifier-rust/

# Run container
docker run -p 8087:8087 truxify-zkp-rust
```
