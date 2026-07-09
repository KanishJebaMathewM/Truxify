# Contributing to Truxify

First off, thank you for considering contributing to Truxify! We appreciate every contribution, whether it's reporting bugs, suggesting features, improving documentation, or submitting code changes.

Truxify is a broker-free, ML-powered, blockchain-secured freight platform built to connect manufacturers directly with truck drivers. By contributing, you're helping make logistics management more efficient, transparent, and fair for India's 1.4 crore truck drivers.

## Table of Contents

* Getting Started
* Repository Architecture
* Development Setup
  * Flutter Apps (Customer & Driver)
  * Backend API (Node.js)
  * ML & Smart Contracts (Placeholders)
* Branch Naming Convention
* Commit Message Guidelines
* Pull Request Process
* Code Style Guidelines
  * Flutter / Dart Style
  * Database & Security Guidelines
  * Backend Node.js / JavaScript Style
* Local Development with BYPASS_AUTH
* Local Development Environment (Docker)
* Reporting Bugs
* Suggesting Features
* Community Guidelines

---

## Getting Started

Before contributing, please:

1. Check existing issues and pull requests to avoid duplicate work.
2. Create an issue if one does not already exist for the change you want to make.
3. Wait for maintainers to assign the issue before starting work.
4. Read our project layout to understand where your changes should go.

---

## Repository Architecture

Truxify is structured as a monorepo containing the following components:

* **`apps/customer`**: Customer Flutter application (load posting, tracking, Voice AI).
* **`apps/driver`**: Driver Flutter application (load matching, en-route suggestion, earnings).
* **`backend/api`**: Node.js & Express API backend (Supabase, WebSockets, Redis, MongoDB).
* **`backend/ml`**: FastAPI Python service for machine learning models (Inference engine).
* **`blockchain/`**: Solidity smart contracts for Polygon escrow, reputations, and document hashes.

---

## Backend Architecture

The backend API (`backend/api`) follows a layered service-oriented architecture. Understanding this structure is essential before contributing new features.

### Service Layer

Routes are thin — they parse the request, delegate to a service, and send the response. All business logic lives in services:

```text
┌─────────────────────────────────────────────┐
│                  ROUTES                      │
│   (thin: parse + delegate + respond)        │
├─────────────────────────────────────────────┤
│                 MIDDLEWARE                   │
│  auth · correlation-id · idempotency · log  │
├─────────────────────────────────────────────┤
│                 SERVICES                     │
│  OrderService · OrderLifecycleService        │
│  OrderValidationService · TimelineService   │
│  NotificationService · DriverService        │
│  LoadService · TrackingService              │
├─────────────────────────────────────────────┤
│                REPOSITORIES                  │
│  OrderRepository · DriverRepository         │
│  BidRepository · LoadRepository             │
│  TimelineRepository                         │
├─────────────────────────────────────────────┤
│            SUPABASE (PostgreSQL)             │
│  via supabase-js (service_role key)         │
│  + MongoDB (GPS logs) + Redis (cache/queue) │
└─────────────────────────────────────────────┘
```

### Adding New Logic

| If you need to… | Put it in… |
|---|---|
| Handle a new API request | A **route** in `src/routes/` |
| Validate business rules | An **assertion** in the appropriate **service** |
| Query or mutate the database | A **repository** method |
| Orchestrate a multi-step workflow | A **service** that coordinates repositories |
| Send a notification | The **NotificationService** |
| Add cross-cutting behaviour | **Middleware** in `src/middleware/` |

### Architecture Decision Records

Detailed design decisions — including why each pattern was chosen, the alternatives considered, and the consequences — are documented as Architecture Decision Records (ADRs):

| ADR | Topic |
|-----|-------|
| [ADR-0001](docs/architecture/adr/ADR-0001-service-layer.md) | Service Decomposition |
| [ADR-0002](docs/architecture/adr/ADR-0002-repository-pattern.md) | Repository Pattern |
| [ADR-0003](docs/architecture/adr/ADR-0003-order-lifecycle.md) | Order Lifecycle Orchestrator |
| [ADR-0004](docs/architecture/adr/ADR-0004-validation-workflow.md) | Validation & Workflow |
| [ADR-0005](docs/architecture/adr/ADR-0005-timeline-management.md) | Timeline Management |
| [ADR-0006](docs/architecture/adr/ADR-0006-notification-workflow.md) | Notification & OTP Workflow |

Read the full set at `docs/architecture/adr/`.

---

## Development Setup

### 1. Fork and Clone the Repository

Click the **Fork** button on the GitHub repository page, and clone your fork locally:

```bash
git clone https://github.com/KanishJebaMathewM/Truxify.git
cd Truxify
```

### 2. Set Up the Flutter Apps

Both the customer and driver apps require Flutter SDK `3.x` or higher.

#### Customer App
```bash
cd apps/customer
flutter pub get
flutter run
```

#### Driver App
```bash
cd apps/driver
flutter pub get
flutter run
```

### 3. Set Up the Backend API

The main API requires Node.js `20.x` or higher.

```bash
cd backend/api
npm install
```

#### Configure Environment Variables
Copy the example environment file and update the variables (Supabase, Firebase, Redis, MongoDB configs):
```bash
cp .env.example .env
```

#### Flutter Development Setup

Both Flutter applications (Customer & Driver) require:
- **Flutter SDK**: `3.x` or higher.
- **Android Studio**: Android SDK and emulator configured.
- **Xcode (macOS only)**: Required for building/running iOS apps.

##### Required Environment Variables

You must document and set the following minimum environment variables inside your `.env` configuration file:

| Variable | Purpose |
|----------|---------|
| `TRUXIFY_API_BASE_URL` | Backend API URL (default: `http://localhost:5000` for local run) |
| `SUPABASE_URL` | Supabase project endpoint |
| `SUPABASE_ANON_KEY` | Public Supabase client key |
| `FIREBASE_PROJECT_ID` | Firebase project identifier |
| `FIREBASE_API_KEY` | Firebase API key |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender identifier |

##### Example Local Development Workflow

1. Clone the repository and navigate to the project root:
   ```bash
   git clone <repo-url>
   cd Truxify
   ```

2. Copy the environment configuration template:
   ```bash
   cp .env.example .env
   ```
   *(Update the values in `.env` with your local config/tokens. Refer to [ENVIRONMENT_SETUP.md](file:///c:/Users/Admin/Desktop/Truxify/docs/ENVIRONMENT_SETUP.md) for more details.)*

3. Launch the applications using one of the following methods:

   **Method A: Using Makefile (Quickest)**
   Ensure you have configured `.env` at the root, then run:
   ```bash
   # Run Driver App
   make run-driver
   
   # Run Customer App
   make run-customer
   ```

   **Method B: Using VS Code Launch Configurations**
   Open the workspace in VS Code. Go to the "Run and Debug" panel, and select either:
   - `Driver App (Auto Env)` or `Driver App (Manual)`
   - `Customer App (Auto Env)` or `Customer App (Manual)`

   **Method C: Manual terminal command**
   Generate the configuration JSON files first:
   ```bash
   ./scripts/generate_dart_defines.sh
   ```
   Then launch the desired app:
   ```bash
   # Customer App
   cd apps/customer
   flutter run --dart-define-from-file=dart_define.json
   
   # Driver App
   cd apps/driver
   flutter run --dart-define-from-file=dart_define.json
   ```

##### Security Guidance
- **Never commit your `.env` file** to version control (it is ignored by default via `.gitignore`).
- **Never commit production credentials** or Firebase configuration secrets.
- Use only example/mock values in documentation.

#### Start Backend Dev Server
```bash
npm run dev
```

---

## Branch Naming Convention

Please follow these naming conventions for your branches:

```text
feature/add-driver-dashboard
feature/improve-trip-history

fix/login-validation
fix/payment-calculation

docs/update-contributing-guide
docs/improve-readme
```

---

## Commit Message Guidelines

Use clear and descriptive commit messages following the Conventional Commits specification:

```text
feat: add driver earnings dashboard

fix: resolve trip history pagination issue

docs: update setup instructions

refactor: simplify pricing calculation logic
```

---

## Pull Request Process

1. Ensure your branch is up-to-date with the `main` branch.
2. Make focused changes related to a single issue.
3. Verify your changes build and run locally without errors.
4. Run formatting and lint checks on your code (see Code Style Guidelines below).
5. Submit a Pull Request targeting the `main` branch and reference the issue number:
   ```text
   Fixes #123
   ```

### Pull Request Checklist

* [ ] Code builds successfully (Flutter run / Node.js starts)
* [ ] Dart and JavaScript formatting checks pass
* [ ] No unnecessary files included
* [ ] Documentation updated if needed
* [ ] Changes tested locally
* [ ] PR linked to an active issue

---

## Code Style Guidelines

### General

* Write clean, readable, and self-documenting code.
* Avoid unnecessary complexity.
* Follow the existing project structure and design patterns.
* Use meaningful variable and function names.

### Flutter / Dart Guidelines

* Format your code using the Dart formatter:
  ```bash
  dart format .
  ```
* Resolve all lint warnings generated by the project analysis options (see `analysis_options.yaml` in both apps).
* Follow the official [Dart Style Guide](https://dart.dev/guides/language/effective-dart/style).

### Database & Security Guidelines

#### Row Level Security (RLS) Architecture

Truxify uses two Supabase keys with very different privilege levels:

| Key | Used by | Bypasses RLS? |
|-----|---------|---------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Backend Node.js API | ✅ Yes — full unrestricted access |
| `SUPABASE_ANON_KEY` | Flutter apps (customer & driver) | ❌ No — RLS policies are enforced |

This means **all client-side queries from Flutter go through RLS**. The backend API is trusted and bypasses it entirely.

#### Policy Pattern

Every protected table must have two policy groups:

```sql
-- 1. Service role: full CRUD (backend API)
CREATE POLICY "Service role full access on <table>"
  ON <table> FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Authenticated users: own data only (Flutter clients)
CREATE POLICY "Users access own <table>"
  ON <table> FOR ALL TO authenticated
  USING  (<owner_column> = get_profile_id())
  WITH CHECK (<owner_column> = get_profile_id());
```

The `get_profile_id()` function resolves the current Firebase UID (from `auth.jwt() ->> 'sub'`) to the corresponding `profiles.id` UUID.

#### Adding New RLS Policies

* All new policies go in `docs/supabase/migrations/002_rls_policies.sql`.
* Use the `DROP POLICY IF EXISTS / CREATE POLICY` pattern so the file stays idempotent (safe to re-run).
* Wrap any new migration file in a `BEGIN; ... COMMIT;` transaction to ensure atomicity.
* Run the migration before deploying any schema change that involves direct client access.

#### Applying Migrations

```bash
# Via psql
psql -f docs/supabase/migrations/002_rls_policies.sql

# Via Supabase CLI
supabase db push

# Or paste directly into: Supabase Dashboard → SQL Editor → New Query
```

#### Testing RLS Policies Locally

Use the Supabase local stack (`supabase start`) and impersonate users with `SET LOCAL role`:

```sql
-- Verify a user cannot read another user's profile
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub": "firebase-uid-of-user-A"}';

  -- This should return 0 rows (user A cannot see user B's profile)
  SELECT count(*) FROM profiles WHERE firebase_uid = 'firebase-uid-of-user-B';
ROLLBACK;
```

Alternatively, use the Supabase Table Editor → toggle **"View as role: authenticated"** to validate policies interactively.

#### Common RLS Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Flutter client gets empty results | RLS enabled but no `authenticated` policy | Add an ownership policy for that table |
| Backend API returns 403 / permission denied | Using `anon` key instead of `service_role` key | Check `SUPABASE_SERVICE_ROLE_KEY` is set in `.env` |
| `get_profile_id()` returns `null` | Firebase UID not in `profiles.firebase_uid` | Ensure profile row exists; check JWT `sub` claim |
| Policy changes not taking effect | Old policy still exists with same name | Use `DROP POLICY IF EXISTS` before `CREATE POLICY` |
| Migration failed partway through | No transaction wrapper | Wrap migration in `BEGIN; ... COMMIT;` |

### Backend (Node.js) Guidelines

* The backend uses ES Module syntax (`import`/`export`). Do not use CommonJS `require()`.
* Validate all inputs using schema validation, and handle database and network errors gracefully.
* Ensure sensitive credentials are read from environment variables and never checked into source control.

---

## Local Development Environment (Docker)

This section covers running the **complete** Truxify backend stack locally using Docker Compose — no external cloud accounts required.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose v2)
- Git

### Setup

**1. Copy the environment file:**

```bash
cp .env.example .env
```

**2. Copy the Docker Compose override file:**

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
```

This wires the `api` service to the local `db`, `mongo`, and `redis` containers via `DATABASE_URL`, `MONGODB_URI`, and `REDIS_URL`. Without this step the backend will not connect to local services.

**3. Start the full stack:**

```bash
docker compose up
```

### Expected Services

| Service | Image | Port |
|---------|-------|------|
| `api` | Local build | `5000` |
| `ml-engine` | Local build | `8001` |
| `db` | `postgis/postgis:15-3.3-alpine` | `5432` |
| `mongo` | `mongo:6-jammy` | `27017` |
| `redis` | `redis:7-alpine` | `6379` |

All services communicate through the Docker bridge network.

### Health Verification

Once the stack is up, verify the backend is healthy:

```bash
curl http://localhost:5000/health
```

Expected response (HTTP 200):

```json
{
  "status": "healthy"
}
```

Verify all containers are running:

```bash
docker ps
```

### Inspecting Logs

If a service fails to start, inspect its logs:

```bash
# All services
docker compose logs

# A specific service
docker compose logs api
docker compose logs mongo
docker compose logs db
```

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `api` container exits immediately | Missing `.env` or `docker-compose.override.yml` | Re-run the copy steps above |
| `Connection refused` on port 5000 | Container still starting | Wait ~10 s and retry; check `docker compose logs api` |
| Port already in use (5432 / 27017 / 6379) | Another local process occupies the port | Stop the conflicting service or change the host port in your override file |
| MongoDB won't start | Port 27017 already taken by a local `mongod` | Run `sudo systemctl stop mongod` (Linux) or stop MongoDB from Services (Windows) |
| `/health` returns `404` | Override file not copied — `api` built from wrong branch | Ensure `docker-compose.override.yml` exists and re-run `docker compose up --build` |
| Backend can't reach `db` | `DATABASE_URL` not set in override | Open `docker-compose.override.yml` and confirm `DATABASE_URL` points to `db:5432` |

---

## Reporting Bugs

When reporting a bug, please open a GitHub Issue and include:

* A clear, descriptive title.
* Detailed steps to reproduce the issue.
* Expected vs. actual behavior.
* Relevant screenshots, video recordings, or console logs.
* Details about your local environment (OS, Flutter version, Node.js version, device/emulator).

---

## Suggesting Features

We welcome proposals for new features! When suggesting a feature:

* Describe the problem you want to solve.
* Detail your proposed solution.
* List any expected benefits (e.g., driver convenience, performance optimization).
* Include mockups, diagrams, or user flow sketches if applicable.

---

## Local Development with BYPASS_AUTH

Truxify's authentication middleware supports a `BYPASS_AUTH=true` mode for local development that skips Firebase token verification. Even in bypass mode, application endpoints still look up the user profile from the `profiles` table — so you need seeded profiles to make authenticated requests locally.

### Step 1: Enable Bypass Mode

Add the following to your `.env` file:

```env
BYPASS_AUTH=true
```

> **Never enable `BYPASS_AUTH` in production.** The server will return `503` if `BYPASS_AUTH=true` and `NODE_ENV=production`.

### Step 2: Seed Development Profiles

Run the seed script to create two predictable test profiles in your local Supabase instance:

```bash
cd backend/api
npm run seed:dev
```

This creates:

| Profile | ID | Role |
|---------|-----|------|
| Dev Customer | `11111111-1111-1111-1111-111111111111` | `customer` |
| Dev Driver | `22222222-2222-2222-2222-222222222222` | `driver` |

The script is **idempotent** — running it multiple times will not create duplicates.

### Step 3: Make Authenticated Requests

Pass the seeded profile ID in the `x-user-id` header along with `x-user-role`:

**Customer request:**

```bash
curl -H "x-user-id: 11111111-1111-1111-1111-111111111111" \
     -H "x-user-role: customer" \
     http://localhost:3000/api/orders
```

**Driver request:**

```bash
curl -H "x-user-id: 22222222-2222-2222-2222-222222222222" \
     -H "x-user-role: driver" \
     http://localhost:3000/api/trips
```

### Environment Requirements

The seed script requires these variables in your root `.env` file:

```env
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

Copy `.env.example` to `.env` and fill in your local Supabase credentials before running the script.

---
## Health Verification

After starting the stack, verify that the backend is healthy:

```bash
curl http://localhost:5000/health
```

Expected response:

```json
{
  "status": "healthy"
}
```

You can also inspect running containers:

```bash
docker ps
```

## Troubleshooting

### Check container logs

```bash
docker compose logs api
```

### Restart the API container

```bash
docker restart truxify-api-1
```

### Verify backend health again

```bash
curl http://localhost:5000/health
```

### Common issues

- If MongoDB fails to start, make sure port `27017` is free.
- If PostgreSQL fails to start, check whether port `5432` is already in use.
- If Redis fails to start, verify port `6379` availability.
- Use `docker compose logs <service>` to inspect service-specific errors.

---

## Community Guidelines

Please be respectful and constructive when interacting with other contributors. We welcome contributors of all experience levels and encourage collaboration, learning, and knowledge sharing.

By participating in this project, you agree to follow our Code of Conduct.

---

Thank you for contributing to Truxify and helping make logistics management more efficient and accessible for everyone!


## ⚠️ Environment Setup (Required Before Running)

Truxify uses `--dart-define` flags to separate dev/staging/prod environments.
**Never run `flutter run` without these flags — it will connect to production services.**

### Step 1: Copy the dev template
```bash
cp dart_defines/dev.env.example dart_defines/dev.env
```

### Step 2: Fill in your local values in `dart_defines/dev.env`

For local Supabase, use:
- `SUPABASE_URL=http://localhost:54321` (default Supabase local dev port)
- Get your local anon key from `supabase start` output

### Step 3: Run with dart-defines

**Mac/Linux:**
```bash
flutter run --dart-define=ENV=dev \
            --dart-define=SUPABASE_URL=http://localhost:54321 \
            --dart-define=SUPABASE_ANON_KEY=your-local-key \
            --dart-define=API_BASE_URL=http://localhost:3000
```

**Windows PowerShell:**
```powershell
flutter run `
  --dart-define=ENV=dev `
  --dart-define=SUPABASE_URL=http://localhost:54321 `
  --dart-define=SUPABASE_ANON_KEY=your-local-key `
  --dart-define=API_BASE_URL=http://localhost:3000
```