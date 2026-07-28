# 🔒 Intel SGX Confidential Computing Subsystem

This directory contains the **Intel SGX Hardware Enclave Service** for secure, hardware-isolated execution of sensitive cryptographic computations, financial transaction signing, and private key storage in Truxify.

---

## 📐 Directory Structure

```text
backend/sgx/
├── sgx_service.py       # Python Intel SGX enclave wrapper & AES-GCM-256 seal handler
├── routes.py            # FastAPI REST endpoints for enclave attestation & sealing
├── requirements.txt     # Cryptographic dependencies
└── enclave/             # Intel SGX C/C++ enclave code & EDL manifests
```

---

## 🔒 Hardware Enclave Features

- **Hardware Attestation**: Generates remote attestation quotes for verifiable enclave integrity.
- **Data Sealing (`AES-GCM-256`)**: Seals sensitive user PII and private keys using SGX MRENCLAVE key derivation.
- **Isolated Execution**: Financial escrow computations execute inside memory-encrypted hardware boundaries.

---

## 🔌 REST Endpoints (`routes.py`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/sgx/init` | `POST` | Initializes the hardware enclave instance. |
| `/sgx/attestation` | `GET` | Generates a signed remote attestation quote. |
| `/sgx/seal` | `POST` | Seals data using enclave-derived key. |
| `/sgx/unseal` | `POST` | Decrypts and unseals data inside enclave. |
