# 🔒 Truxify Security Policy

Truxify is committed to maintaining the highest security standards across our logistics platform, API backend, smart contracts, machine learning pipelines, and mobile applications.

---

## 🛡️ Supported Versions

We release regular security patches for active major versions of the Truxify codebase:

| Component | Supported Version | Status |
| :--- | :--- | :--- |
| Node.js Express API (`backend/api`) | `v1.x` | :white_check_mark: Supported |
| FastAPI ML Engine (`backend/ml`) | `v1.x` | :white_check_mark: Supported |
| Polygon Smart Contracts (`blockchain`) | Mainnet / Amoy | :white_check_mark: Supported |
| Customer & Driver Flutter Apps (`apps/`) | `v1.x` | :white_check_mark: Supported |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability, flaw, or potential exploit in Truxify, please report it responsibly rather than opening a public GitHub issue.

### Preferred Reporting Channel:
- **Email**: Send your findings to **`security@truxify.org`** or contact project leads directly.

### What to Include in Your Report:
1. **Description**: Clear summary of the potential vulnerability and affected endpoint, contract, or component.
2. **Proof of Concept (PoC)**: Step-by-step reproduction steps or sample request payloads.
3. **Impact**: Assessment of potential operational or data confidentiality risk.

### Responsible Disclosure Guidelines:
- Allow our security team up to **48 hours** to acknowledge receipt of your report.
- We aim to issue a triage assessment within **5 business days** and release an appropriate patch within **14 business days**.
- Please do not disclose vulnerabilities publicly until a patch has been officially released.

---

## 🔒 Security Architecture Highlights

- **Row Level Security (RLS)**: Enforced across all PostgreSQL/Supabase database tables.
- **HMAC / JWT Validation**: Strict token verification and API Key checks on all inter-service routes.
- **Smart Contract Escrow**: Time-locked escrow payments on Polygon blockchain with cryptographic OTP verification.
- **Middleware Protections**: Built-in rate limiting, HTTP Parameter Pollution defense, CORS policies, secure cookie flags, and brute-force auth monitoring.
