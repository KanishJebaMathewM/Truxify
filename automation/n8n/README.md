# Automation & Workflow Orchestration (n8n)

This directory contains production-ready **n8n workflow graphs**, documentation, and sequence diagrams for operational automation, AI model lifecycle management, dispute resolution, and driver verification in the Truxify logistics platform.

---

## 📋 Available Workflows

| Workflow File | Name | Trigger | Description |
| :--- | :--- | :--- | :--- |
| [`workflows/dispute_resolution.json`](./workflows/dispute_resolution.json) | **Dispute Resolution Pipeline** | Webhook (`POST /api/webhooks/n8n/dispute-trigger`) | Automated dispute arbitration: checks 2-hour OTP status, gathers driver GPS trail, executes escrow release if eligible, or escalates unresolved disputes for manual Ops review with 24h escalation timer. |
| [`workflows/ml_retraining.json`](./workflows/ml_retraining.json) | **Weekly ML Model Retraining Pipeline** | Cron (`Every Sunday 02:00 UTC`) | Queries order volume ($\ge 100$ completed orders required). Triggers `POST /train/demand` with distributed lease lock, validates $R^2$ performance metrics, and executes automated rollback if performance degrades. |
| [`workflows/oracle_sync.json`](./workflows/oracle_sync.json) | **Multi-Oracle Gas & Escrow Sync** | Cron (`Every 5 Minutes`) | Fetches Polygon gas prices with hex/isFinite validation and routes valid rates to `/api/internal/oracle/gas`. |
| [`workflows/sentinel_security.json`](./workflows/sentinel_security.json) | **Sentinel Security Defensive Pause** | Webhook / Event | Detects frontrunning and flash loan anomaly patterns and triggers immediate defensive pause on `/api/internal/defensive-pause`. |
| [`ml-rollback-workflow.json`](./ml-rollback-workflow.json) | **Demand Forecast Auto-Rollback Pipeline** | Schedule (`Every 1 Hour`) | Checks active A/B tests on ML Engine (`http://ml-engine:8000/ab-testing/status`). Executes auto-rollback if performance degradation threshold is breached. |

---

## 📁 Directory Structure

```text
automation/n8n/
├── README.md                           # Overview and setup guide
├── workflows/                          # Main workflow export JSON files
│   ├── dispute_resolution.json         # Dispute resolution pipeline
│   ├── ml_retraining.json              # Weekly ML model retraining pipeline
│   ├── oracle_sync.json                # Oracle gas sync pipeline
│   ├── sentinel_security.json          # Sentinel security defensive pause
│   ├── circuit_breaker.json            # Escrow circuit breaker
│   └── gas_refiller.json               # Relayer gas refiller
├── docs/                               # Workflow documentation & Mermaid diagrams
│   ├── dispute_flow_diagram.md         # Dispute resolution sequence diagram
│   ├── retraining_flow_diagram.md      # ML retraining sequence diagram
│   ├── oracle_sync_flow.md             # Oracle sync flow diagram
│   └── sentinel_security_flow.md       # Security sentinel flow diagram
└── tests/                              # Automated security and structural tests
    ├── dispute-resolution.test.js
    ├── dispute-resolution.security.test.js
    ├── ml_retraining.test.js
    ├── internal-api-auth.security.test.js
    └── validate_oracle_sync.js
```

---

## 🛠️ Integrated Backend API Endpoints

The n8n workflows interact directly with the Truxify backend service through dedicated endpoints:

| Endpoint | Method | Authentication | Description |
| :--- | :--- | :--- | :--- |
| `/api/webhooks/n8n/dispute-trigger` | `POST` | `x-api-key` | Triggers dispute resolution workflow after 2-hour unconfirmed delivery timeout. |
| `/api/internal/dispute-evidence/:orderId` | `GET` | `requireApiKey` | Collects GPS telemetry points and OTP verification status for dispute decisioning. |
| `/api/escrow/release` | `POST` | `requireApiKey` | Executes on-chain escrow payout release when auto-resolution criteria pass. |
| `/api/dispute/escalate` | `PATCH` | `requireApiKey` | Sets `escalated_at = NOW()` for manual Ops review when evidence is incomplete. |
| `/api/internal/training-readiness` | `GET` | `requireApiKey` | Checks if completed order volume $\ge 100$ before starting ML model retraining. |
| `/api/internal/ml-lock` | `POST` / `DELETE` | `requireApiKey` | Acquires, renews (`/renew`), and releases Redis atomic lease lock for training runs. |

---

## 🛠️ Environment Configuration

Set the following environment variables in `.env` or `docker-compose.yml`:

| Environment Variable | Description | Default / Dev Value |
| :--- | :--- | :--- |
| `N8N_USER` | Basic auth username for n8n Web Console | `admin` |
| `N8N_PASSWORD` | Basic auth password for n8n Web Console | `changeme` |
| `ML_API_KEY` | API Key for authenticating against the FastAPI ML Engine | `local_ml_secret` |
| `ML_ENGINE_URL` | Base URL of the ML service container | `http://ml-engine:8000` |
| `BACKEND_API_URL` | Base URL of the Express API container | `http://api:5000` |
| `ADMIN_ALERT_EMAIL` | Ops notification mailbox for dispute escalations & escrow release failures | `admin@localhost` |
| `ML_ALERT_EMAIL` | ML Engineering mailbox for model retraining performance reports | `ml-ops@localhost` |
| `DISPUTE_WEBHOOK_SECRET` | HMAC secret protecting dispute webhook triggers | `local_dispute_secret` |

---

## 🚀 Running n8n Locally

n8n is fully integrated as a self-hosted Docker service in [`docker-compose.yml`](../../docker-compose.yml).

Start the n8n container:

```bash
docker compose up n8n -d
```

Access the n8n Web UI:
```text
http://localhost:5678
```

### Running Test Suite

Verify all workflow JSON files, authentication parameters, and structural invariants:

```bash
node automation/n8n/tests/dispute-resolution.security.test.js
node automation/n8n/tests/dispute-resolution.test.js
node automation/n8n/tests/ml_retraining.test.js
node automation/n8n/tests/internal-api-auth.security.test.js
python automation/n8n/validate_ml_rollback.py
python automation/n8n/validate_oracle_sync.py
```
