# Automation & Workflow Orchestration (n8n)

This directory contains production-ready **n8n workflow graphs** for operational automation, AI model lifecycle management, dispute resolution, and driver verification in the Truxify logistics platform.

---

## 📋 Available Workflows

| Workflow File | Name | Trigger | Description |
| :--- | :--- | :--- | :--- |
| [`dispute_resolution.json`](./dispute_resolution.json) | **Truxify Dispute Resolution Pipeline** | Webhook (`POST /webhook/disputes`) | Automated 24-hour dispute arbitration: fetches driver GPS telemetry, verifies 500m destination geofence and OTP, auto-releases escrow if validated or escalates to human arbitrators via email. |
| [`ml_retraining.json`](./ml_retraining.json) | **Weekly ML Model Retraining Pipeline** | Cron (`Monday 02:00 AM`) | Queries PostgreSQL for completed bookings in the last 7 days. If $\ge 100$ new bookings exist, triggers `POST /train/demand` to retrain demand models and emails performance metrics (MAE, RMSE, R²). |
| [`document-integrity-workflow.json`](./document-integrity-workflow.json) | **Document Integrity Check Workflow** | Schedule (`Every 24 Hours`) | Periodically queries driver active statuses and KYC document expiration/verification statuses. Sends automated alerts if tampering or expiry is detected. |
| [`ml-rollback-workflow.json`](./ml-rollback-workflow.json) | **ML Model Auto-Rollback Pipeline** | Schedule (`Every 1 Hour`) | Checks active A/B tests on the ML Engine (`http://ml-engine:8000/ab-testing/status`). If performance degradation exceeding threshold is detected, executes auto-rollback and alerts the ML team. |

---

## 🛠️ Environment Configuration

When importing workflows into your n8n instance, ensure the following environment variables are configured in n8n or `docker-compose.yml`:

| Environment Variable | Description | Default / Dev Value |
| :--- | :--- | :--- |
| `INTERNAL_RELAYER_KEY` | HMAC secret for relayer API calls to backend Express service | `local_relayer_secret` |
| `ML_API_KEY` | API Key for authenticating against the FastAPI ML Engine | `local_ml_secret` |
| `ML_ENGINE_URL` | Base URL of the ML service container | `http://ml-engine:8000` |
| `N8N_ENCRYPTION_KEY` | Master encryption key for n8n credentials | Configured in `docker-compose.prod.yml` |

---

## 🚀 Running n8n Locally

n8n is included as a service in both development ([`docker-compose.yml`](../../docker-compose.yml)) and production ([`docker-compose.prod.yml`](../../docker-compose.prod.yml)).

To start n8n locally:

```bash
docker compose up n8n -d
```

Access the n8n Web Console at:
```text
http://localhost:5678
```

### Importing Workflows into n8n:
1. Open n8n UI (`http://localhost:5678`).
2. Click **Workflows** → **Import from File**.
3. Select any `.json` file from `automation/n8n/`.
4. Configure required credentials (PostgreSQL, Email/SMTP, HTTP Header Auth) and click **Activate**.
