# Contributing to Truxify

Thank you for considering contributing to Truxify! We appreciate every contribution—whether reporting bugs, improving documentation, submitting feature requests, or writing code.

Truxify is a broker-free, ML-powered, blockchain-secured freight platform built to connect manufacturers directly with truck drivers across India. By contributing, you help empower India's 1.4 crore truck drivers with transparent pricing, instant payments, and route optimization.

---

## 📐 Table of Contents

- [Project Architecture & Monorepo Overview](#-project-architecture--monorepo-overview)
- [Prerequisites](#-prerequisites)
- [Local Setup & Getting Started](#-local-setup--getting-started)
  - [1. Customer App (Flutter)](#1-customer-app-flutter)
  - [2. Driver App (Flutter)](#2-driver-app-flutter)
  - [3. Backend API (Node.js & Express)](#3-backend-api-nodejs--express)
  - [4. ML Inference Engine (FastAPI & Python)](#4-ml-inference-engine-fastapi--python)
  - [5. Smart Contracts (Polygon / Hardhat)](#5-smart-contracts-polygon--hardhat)
  - [6. Running via Docker Compose](#6-running-via-docker-compose)
- [Environment Variables Guide](#-environment-variables-guide)
- [Branch Naming Convention](#-branch-naming-convention)
- [Commit Message Guidelines](#-commit-message-guidelines)
- [Pull Request Process](#-pull-request-process)
- [Issue Labels Guide](#-issue-labels-guide)
- [Code Style & Linting Commands](#-code-style--linting-commands)

---

## 🏗️ Project Architecture & Monorepo Overview

Truxify is organized as a monorepo containing frontends, backends, machine learning services, and smart contracts:

```text
Truxify Monorepo Root
├── apps/
│   ├── customer/        # Customer Flutter App (load posting, tracking, Voice AI)
│   └── driver/          # Driver Flutter App (active trip, en-route loads, earnings)
├── backend/
│   ├── api/             # Node.js Express API (auth, orders, trips, Redis, Supabase)
│   └── ml/              # FastAPI Python service (ETA, pricing, demand, route optimization)
├── blockchain/          # Solidity Smart Contracts (TruxifyEscrow, reputation, ZKP)
├── packages/
│   └── truxify_shared/  # Shared Dart models, ApiClient, theme tokens
├── docs/                # Architecture docs & OSRM setup guides
└── .github/             # Issue templates & PR workflow automation
```

---

## 🛠️ Prerequisites

Ensure you have the following installed on your local machine:

| Tool | Recommended Version | Download Link |
|---|---|---|
| **Flutter SDK** | `>= 3.19.0` | [flutter.dev](https://flutter.dev) |
| **Node.js** | `>= 20.x` (LTS) | [nodejs.org](https://nodejs.org) |
| **Python** | `>= 3.11.x` | [python.org](https://python.org) |
| **Docker & Compose** | Latest | [docker.com](https://www.docker.com) |
| **Git** | Latest | [git-scm.com](https://git-scm.com) |

---

## 🚀 Local Setup & Getting Started

### 1. Customer App (Flutter)

```bash
cd apps/customer
flutter pub get
flutter analyze
flutter test
flutter run
```

### 2. Driver App (Flutter)

```bash
cd apps/driver
flutter pub get
flutter analyze
flutter test
flutter run
```

### 3. Backend API (Node.js & Express)

```bash
npm install
npm run lint
npm test
npm run dev
```

> 💡 **Local Development with `BYPASS_AUTH`**:
> For local testing without active Firebase credentials, set `BYPASS_AUTH=true` and `DEV_ACCESS_TOKEN=test-access-token` in `backend/api/.env`.

### 4. ML Inference Engine (FastAPI & Python)

```bash
cd backend/ml
python -m venv venv
# On Windows: venv\Scripts\activate | On Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn main:app --reload --port 8000
```

### 5. Smart Contracts (Polygon / Hardhat)

```bash
cd blockchain
npm install
npx hardhat compile
npx hardhat test
```

### 6. Running via Docker Compose

To launch the complete Truxify stack (Node.js API + FastAPI ML + Redis + OSRM):

```bash
cp .env.example .env
docker compose up --build
```

---

## 🔑 Environment Variables Guide

Copy `.env.example` at the repository root or in component directories to set your local environment variables:

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Node.js Backend API Port | `8080` |
| `JWT_SECRET` | Backend JWT signing secret | `truxify-jwt-secret-key` |
| `POLYGON_RPC_URL` | Polygon JSON-RPC Endpoint | `https://polygon-mumbai.g.alchemy.com/v2/...` |
| `ESCROW_CONTRACT_ADDRESS` | Deployed TruxifyEscrow contract | `0x1234567890abcdef1234567890abcdef12345678` |
| `UPSTASH_REDIS_REST_URL` | Redis Caching REST Endpoint | `https://...upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Redis Caching Authentication Token | `AZ...` |
| `N8N_DISPUTE_WEBHOOK_URL` | n8n Dispute Resolution Webhook | `https://n8n.truxify.com/webhook/dispute` |
| `BYPASS_AUTH` | Bypass Firebase Auth in local dev | `true` |

---

## 🌿 Branch Naming Convention

Always branch off `main` or the active sprint branch using the following naming structure:

- **Features**: `feat/<issue-number>-short-description` (e.g. `feat/472-fcm-notifications`)
- **Bug Fixes**: `fix/<issue-number>-short-description` (e.g. `fix/312-redis-cache-invalidation`)
- **Documentation**: `docs/<issue-number>-short-description` (e.g. `docs/501-contributing-guide`)
- **Refactoring**: `refactor/<issue-number>-short-description` (e.g. `refactor/128-order-lifecycle`)

---

## 📝 Commit Message Guidelines

We follow the **Conventional Commits** specification:

```text
<type>(<scope>): <short summary>

[optional body]
```

### Commit Types

- `feat`: A new feature for the user or API.
- `fix`: A bug fix.
- `docs`: Documentation changes only.
- `test`: Adding or updating unit/integration tests.
- `refactor`: Code changes that neither fix a bug nor add a feature.
- `chore`: Maintenance tasks, dependency updates, build configs.

### Examples

```bash
git commit --no-verify -m "feat(voice): integrate Voice AI Assistant in Customer App and Express Backend"
git commit --no-verify -m "fix(cache): resolve Redis cache-aside TTL expiry on demand heatmap"
```

---

## 📬 Pull Request Process

1. **Self-Review**: Perform a self-review of your code before opening the PR.
2. **Run Tests**: Ensure all automated tests pass (`npm test`, `flutter test`, `pytest`).
3. **Use PR Template**: Fill out `.github/PULL_REQUEST_TEMPLATE.md` completely.
4. **Link Issues**: Use `Closes #<issue_number>` in the PR body.
5. **No Verification Bypass in PRs**: Ensure pre-commit hooks pass.

---

## 🏷️ Issue Labels Guide

| Label | Description |
|---|---|
| `gsssoc` | Open for GirlScript Summer of Code contributors |
| `phase-1` | Core Driver & Customer MVP screens & routes |
| `phase-2` | Authentication, Redis caching & Voice AI integrations |
| `phase-3` | En-Route load suggestions & ML optimization |
| `phase-4` | Polygon Blockchain Event Listener & smart contract escrow |
| `good first issue` | Great entry points for first-time contributors |
| `bug` | Confirmed software bug requiring a fix |
| `enhancement` | New feature or improvement request |

---

## 🧹 Code Style & Linting Commands

| Layer | Command |
|---|---|
| **Flutter Apps** | `flutter analyze` |
| **Node.js Backend** | `npm run lint` |
| **Python ML Service** | `ruff check .` or `flake8` |
| **Solidity Contracts** | `npx solhint 'contracts/**/*.sol'` |

**Mac/Linux:**
```bash
flutter run --dart-define=ENV=dev \
            --dart-define=SUPABASE_URL=http://localhost:54321 \
            --dart-define=SUPABASE_ANON_KEY=your-local-key \
            --dart-define=TRUXIFY_API_BASE_URL=http://localhost:5000
```

**Windows PowerShell:**
```powershell
flutter run `
  --dart-define=ENV=dev `
  --dart-define=SUPABASE_URL=http://localhost:54321 `
  --dart-define=SUPABASE_ANON_KEY=your-local-key `
  --dart-define=TRUXIFY_API_BASE_URL=http://localhost:5000
```
