# Deploying Truxify to Production

> Self-hosting guide for production deployment of the Truxify freight platform.

**Audience:** DevOps engineers, system administrators, and technical contributors who want to run Truxify in production.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Architecture Overview](#architecture-overview)
4. [Environment Reference](#environment-reference)
5. [Docker Compose (Production)](#docker-compose-production)
6. [Render Deployment](#render-deployment)
7. [Database Setup & Migrations](#database-setup--migrations)
8. [Domain & SSL](#domain--ssl)
9. [Monitoring & Maintenance](#monitoring--maintenance)
10. [Backup & Recovery](#backup--recovery)
11. [Scaling Considerations](#scaling-considerations)
12. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying, ensure you have:

| Resource | Requirement | Notes |
|----------|-------------|-------|
| **Domain** | One or more domains with DNS access | e.g., `api.truxify.com`, `ml.truxify.com`, `n8n.truxify.com` |
| **Docker** | Docker Engine 24+ & Docker Compose v2 | [Install Docker](https://docs.docker.com/engine/install/) |
| **Server** | Linux (Ubuntu 22.04 / Debian 12 recommended) | Minimum 4 GB RAM, 2 vCPUs, 20 GB SSD |
| **PostgreSQL** | Supabase project or self-hosted Postgres 15+ with PostGIS | See [Database Setup](#database-setup--migrations) |
| **MongoDB** | MongoDB 6+ (Atlas or self-hosted) | For GPS telemetry storage |
| **Redis** | Redis 7+ (Upstash or self-hosted) | For caching and rate limiting |
| **Firebase** | Firebase project with Auth + FCM enabled | Phone OTP and push notifications |
| **Cloudflare R2** (optional) | R2 bucket for document/file storage | Can use any S3-compatible provider |
| **Polygon RPC** (optional) | Polygon RPC URL for blockchain features | Public or private RPC endpoint |

> **Cost-saving tip:** All core services (Supabase free tier, MongoDB Atlas M0, Upstash Redis free tier, Render free tier) can run the platform at near-zero cost during early production. See [architecture.md](architecture.md#production-stack) for pricing details.

---

## Quick Start

Deploy the full stack in 5 steps:

```bash
# 1. Clone the repository
git clone https://github.com/KanishJebaMathewM/Truxify.git
cd Truxify

# 2. Configure environment
cp .env.example .env
# Edit .env with your production values (see env reference below)

# 3. Set secure passwords
# Generate a strong ML_API_KEY:
openssl rand -hex 32
# Generate a strong DB_PASSWORD:
openssl rand -hex 16

# 4. Start the production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 5. Verify health
curl http://localhost:5000/api/health/live
```

Expected response:

```json
{"status": "healthy", "timestamp": "2026-07-20T12:00:00.000Z"}
```

---

## Architecture Overview

```
                    ┌─────────────┐
                    │   Clients    │
                    │ (Flutter App)│
                    └──────┬──────┘
                           │ HTTPS
                    ┌──────▼──────┐
                    │   Reverse   │
                    │   Proxy     │  ← Caddy / Nginx (SSL termination)
                    │ (Port 443)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼─────┐ ┌───▼────┐ ┌────▼─────┐
       │  API        │ │  ML    │ │  n8n     │
       │  Node.js    │ │FastAPI │ │Automation│
       │  :5000      │ │:8001   │ │:5678     │
       └──────┬──────┘ └────────┘ └──────────┘
              │
    ┌─────────┼─────────────┐
    │         │             │
┌───▼───┐ ┌──▼──┐     ┌────▼────┐
│PostGIS│ │Mongo│     │  Redis  │
│:5432  │ │:27017│    │ :6379   │
└───────┘ └─────┘     └─────────┘
```

### Service Communication Matrix

| From | To | Protocol | Port |
|------|----|----------|------|
| Clients → API | REST / WS | HTTPS | 443 → 5000 |
| API → ML Engine | HTTP | HTTP | 8001 |
| API → PostGIS | TCP | 5432 |
| API → MongoDB | TCP | 27017 |
| API → Redis | TCP | 6379 |
| n8n → API | HTTP | 5000 |
| n8n → PostGIS | TCP | 5432 |

---

## Environment Reference

All configuration is managed through a single `.env` file at the project root. The template is at [`.env.example`](../.env.example).

Variables are grouped by category. **Bold** names are required for production.

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **`PORT`** | Yes | `5000` | Backend API listen port |
| `API_PUBLIC_URL` | Recommended | `http://localhost:5000/api` | Public-facing API URL (used for webhook callbacks) |

### Authentication Bypass (Development Only)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BYPASS_AUTH` | No | `true` | Must be `false` or unset in production. Server crashes if `true` in `NODE_ENV=production` |
| `DEV_ACCESS_TOKEN` | No | — | Short-lived token for dev auth bypass. Ignored in production. |

> **⚠️ CRITICAL:** Never set `BYPASS_AUTH=true` in production. The server validates this and returns HTTP 503 at startup.

### Supabase / PostgreSQL

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **`SUPABASE_URL`** | Yes | — | Supabase project URL (e.g., `https://your-project.supabase.co`) |
| **`SUPABASE_ANON_KEY`** | Yes | — | Public anonymous key from Supabase Settings → API |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Yes | — | Service role key from Supabase Settings → API. **Never expose to clients.** |
| **`DB_PASSWORD`** | Yes | — | PostgreSQL password for the main database user |

**Where to obtain:** Create a project at [supabase.com](https://supabase.com) → Project Settings → API. The `service_role` key is in the same section.

### MongoDB

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **`MONGODB_URI`** | Yes | `mongodb://localhost:27017` | MongoDB connection string |
| **`MONGODB_DB_NAME`** | Yes | `truxify_telemetry` | Database name for GPS telemetry and ML data |

**Where to obtain:** Create a cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas) → Connect → Driver → copy connection string.

### Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **`REDIS_URL`** | Yes | `redis://localhost:6379` | Redis connection string |

**Where to obtain:** Create a database at [upstash.com](https://upstash.com) or self-host Redis.

### WebSocket Tracking

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLOCK_SKEW_TOLERANCE_MS` | No | `300000` | Max allowed device clock drift (ms). Telemetry outside this window is dropped. |

### Firebase

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **`FIREBASE_PROJECT_ID`** | Yes | — | Firebase project ID |
| **`FIREBASE_SERVICE_ACCOUNT_JSON`** | Yes | — | Full service account JSON (one line). Used for JWT verification and FCM. |
| **`FIREBASE_API_KEY`** | Yes | — | Firebase Web API key |
| **`FIREBASE_MESSAGING_SENDER_ID`** | Yes | — | Firebase Cloud Messaging sender ID |

**Where to obtain:** [Firebase Console](https://console.firebase.google.com/) → Project Settings → Service Accounts → Generate new private key.

> **Important:** The `FIREBASE_SERVICE_ACCOUNT_JSON` must be a single line of JSON in your `.env` file. Use `tr` to flatten:
> ```bash
> tr -d '\n' < your-service-account.json >> .env
> ```

### Cloudflare R2 (File Storage)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `R2_ACCOUNT_ID` | Recommended | — | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | Recommended | — | R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | Recommended | — | R2 secret access key |
| `R2_BUCKET_NAME` | Recommended | `truxify-docs` | R2 bucket name for documents |
| `R2_PUBLIC_URL_PREFIX` | Recommended | — | Public URL prefix for CDN access |

**Where to obtain:** [Cloudflare Dashboard](https://dash.cloudflare.com/) → R2 → Create bucket → Manage API tokens.

### ML Engine

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **`ML_API_KEY`** | Yes | — | Shared secret between API and ML engine. Generate with `openssl rand -hex 32`. |
| **`ML_ENGINE_URL`** | Yes | `http://localhost:8001` | ML engine endpoint. In Docker Compose, uses internal DNS: `http://ml-engine:8000` |
| `ML_SERVICE_URL` | No | — | Fallback ML URL (checked after `ML_ENGINE_URL`) |
| `ML_TRAINING_TIMEOUT_SECONDS` | No | `300` | Maximum training job runtime before timeout |

### Polygon Blockchain / Escrow

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POLYGON_RPC_URL` | Required for escrow | — | Polygon RPC endpoint (e.g., `https://polygon-rpc.com`) |
| `REPUTATION_CONTRACT_ADDRESS` | Required for escrow | — | Deployed Reputation contract address |
| `DELIVERY_RECEIPTS_CONTRACT_ADDRESS` | Required for escrow | — | Deployed DeliveryReceipts contract address |
| `RELAYER_WALLET_PRIVATE_KEY` | Required for escrow | — | Relayer wallet private key (hex, with `0x` prefix) |
| `ESCROW_MATIC_PER_PAISA` | No | `0.01` | MATIC equivalent of 1 paisa. Used for paisa → MATIC conversion |
| `MAX_ESCROW_MATIC` | No | `5` | Safety cap: reject deposits exceeding this many MATIC |
| `ESCROW_RECONCILIATION_INTERVAL_MS` | No | `60000` | Poll interval for confirmed refunds needing Supabase state update |
| `ESCROW_CONTRACT_ADDRESS` | Required for escrow | — | Deployed Escrow contract address |

**Where to obtain:** Deploy the Solidity contracts in `blockchain/` to Polygon Mumbai (testnet) or Polygon Mainnet. Record each deployed address.

> **⚠️ SECURITY:** The `RELAYER_WALLET_PRIVATE_KEY` controls funds. Store it in a secret manager or use Docker secrets in production. Never commit it to version control.

### Docker Compose Resource Limits (Optional)

These control CPU/memory allocation per service in `docker-compose.prod.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_CPU_LIMIT` | `1` | API container CPU limit (cores) |
| `API_MEM_LIMIT` | `512M` | API container memory limit |
| `ML_CPU_LIMIT` | `2` | ML engine CPU limit (model inference may need more) |
| `ML_MEM_LIMIT` | `1G` | ML engine memory limit |
| `DB_CPU_LIMIT` | `1` | PostgreSQL CPU limit |
| `DB_MEM_LIMIT` | `1G` | PostgreSQL memory limit |
| `MONGO_CPU_LIMIT` | `1` | MongoDB CPU limit |
| `MONGO_MEM_LIMIT` | `1G` | MongoDB memory limit |
| `REDIS_CPU_LIMIT` | `0.5` | Redis CPU limit |
| `REDIS_MEM_LIMIT` | `256M` | Redis memory limit |
| `N8N_CPU_LIMIT` | `1` | n8n CPU limit |
| `N8N_MEM_LIMIT` | `512M` | n8n memory limit |
| `LOG_DRIVER` | `json-file` | Docker logging driver |
| `LOG_MAX_SIZE` | `10m` | Max log file size before rotation |
| `LOG_MAX_FILE` | `3` | Number of rotated log files to retain |

### n8n Automation

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **`N8N_HOST`** | Yes | — | Public hostname for n8n (e.g., `n8n.truxify.com`) |
| **`N8N_ENCRYPTION_KEY`** | Yes | — | Encryption key for n8n credentials. Generate with `openssl rand -hex 32`. |

### Shard Configuration (PostgreSQL Geographic Shards)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SHARD_PASSWORD` | If using shards | `password` | Password for all shard databases. **Override in production.** |

> **Note:** Geographic sharding is in development. In production, you may omit the shard services unless you need horizontal read scaling by region.

---

## Docker Compose (Production)

### File Overview

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base composition (all services, ports, healthchecks) |
| `docker-compose.prod.yml` | Production overrides (resource limits, logging, security) |

### Starting the Stack

```bash
# Pull latest images
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull

# Start all services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Follow startup logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

### What `docker-compose.prod.yml` Adds

| Feature | Development | Production |
|---------|-------------|------------|
| **Build target** | `target: development` (dev deps + hot-reload) | `target: production` (prod deps only) |
| **Volume mounts** | Code mounted from host | No code volumes (baked into image) |
| **CPU limits** | None | Configurable per service |
| **Memory limits** | None | Configurable per service |
| **Restart policy** | None | `unless-stopped` on all services |
| **Logging** | Default (captured by Docker) | Rotating JSON file (10 MB × 3) |
| **Security opt** | None | `no-new-privileges:true` on all services |
| **n8n** | Not included | Automation pipeline service |
| **Redis persistence** | None | AOF + RDB with `allkeys-lru` eviction |

### Stopping the Stack

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

To remove volumes (⚠️ **destroys all data**):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
```

### Updating Services

```bash
# Pull latest code and rebuild
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --pull

# Recreate containers with zero downtime
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
```

---

## Render Deployment

As an alternative to Docker Compose, each service can be deployed individually on [Render](https://render.com). This is suitable when you want managed infrastructure without managing a full Docker host.

### Backend API (Web Service)

| Setting | Value |
|---------|-------|
| **Type** | Web Service |
| **Runtime** | Docker |
| **Build Command** | (uses Dockerfile) |
| **Start Command** | (uses CMD from Dockerfile) |
| **Health Check Path** | `/api/health/live` |
| **Plan** | Starter or higher (512 MB RAM minimum) |

**Environment Variables to set in Render Dashboard:**

```env
NODE_ENV=production
PORT=5000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=truxify_telemetry
REDIS_URL=redis://...
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
FIREBASE_API_KEY=your_api_key
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
ML_API_KEY=your_ml_shared_secret
ML_ENGINE_URL=https://ml-engine.onrender.com
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=truxify-docs
R2_PUBLIC_URL_PREFIX=https://your-bucket.r2.dev
POLYGON_RPC_URL=https://polygon-rpc.com
```

### ML Engine (Web Service)

| Setting | Value |
|---------|-------|
| **Type** | Web Service |
| **Runtime** | Docker |
| **Root Directory** | `backend/ml` |
| **Health Check Path** | `/health` |
| **Plan** | Starter or higher (1 GB RAM recommended for model inference) |

**Environment Variables:**

```env
ML_API_KEY=your_ml_shared_secret
```

> **Important:** The `ML_API_KEY` must match between the API and ML services. Generate once with `openssl rand -hex 32` and use the same value in both.

### n8n Automation (Web Service)

| Setting | Value |
|---------|-------|
| **Type** | Web Service |
| **Runtime** | Docker |
| **Dockerfile** | Use `docker.n8n.io/n8nio/n8n:latest` |
| **Health Check Path** | `/healthz` |
| **Plan** | Starter (512 MB RAM) |

**Environment Variables:**

```env
N8N_HOST=n8n.yourdomain.com
N8N_PROTOCOL=https
N8N_ENCRYPTION_KEY=your_encryption_key
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=your-supabase-host
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=truxify
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=your_db_password
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=336
N8N_METRICS=true
```

### UptimeRobot Monitoring

After deploying all services, set up [UptimeRobot](https://uptimerobot.com) (free tier: 5 monitors) to ping each service's health endpoint every 5 minutes:

| Monitor | URL | Interval |
|---------|-----|----------|
| API | `https://api.yourdomain.com/api/health/live` | 5 min |
| ML Engine | `https://ml.yourdomain.com/health` | 5 min |
| n8n | `https://n8n.yourdomain.com/healthz` | 5 min |

---

## Database Setup & Migrations

### PostgreSQL / Supabase

#### Option A: Supabase (Managed)

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the schema setup:

```bash
# Download the setup SQL
# From the repo:
# docs/supabase_setup.sql contains the full schema

# Or apply via Supabase CLI:
supabase db push
```

3. Apply migrations in order from `docs/supabase/migrations/`:

```bash
# Migration order:
# 1. 002_rls_policies.sql — Row Level Security policies
# 2. test_rls_policies.sql — Validate RLS works

# Run via Supabase Dashboard SQL Editor or psql:
psql -h your-project.supabase.co -U postgres -d postgres \
  -f docs/supabase/migrations/002_rls_policies.sql
```

4. Run individual migration SQL files from `docs/` in dependency order:

```
docs/supabase_setup.sql                  # Full schema (if starting fresh)
docs/migration_add_estimated_price.sql
docs/migration_add_delivery_otp.sql
docs/migration_add_escrow.sql
docs/migration_add_polygon_wallet.sql
docs/migration_add_profiles_polygon_wallet.sql
docs/migration_add_wallet_address.sql
docs/migration_add_milestone_statuses.sql
docs/migration_add_cancellation_reason.sql
docs/migration_add_earnings_daily_unique.sql
docs/migration_add_referential_integrity.sql
docs/migration_add_processed_batches.sql
docs/migration_complete_trip_update.sql
docs/migration_wallet_tx_hash.sql
docs/migration_rls_policies.sql
```

> **Ordering note:** Migrations that add new columns must run before migrations that add RLS policies referencing those columns. RLS migrations should always be last.

#### Option B: Self-Hosted PostgreSQL

```bash
docker run -d \
  --name truxify-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=your_secure_password \
  -e POSTGRES_DB=truxify \
  -v postgres_data:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgis/postgis:15-3.3-alpine
```

Then apply migrations as described above.

### MongoDB

#### Connection String

```
mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/truxify_telemetry?retryWrites=true&w=majority
```

#### Required TTL Indexes

Create these indexes for automatic telemetry data expiration:

```javascript
// Expire GPS pings after 90 days
db.location_pings.createIndex(
  { "recorded_at": 1 },
  { expireAfterSeconds: 7776000 }  // 90 days
);

// Expire driver activity events after 180 days
db.driver_events.createIndex(
  { "created_at": 1 },
  { expireAfterSeconds: 15552000 }  // 180 days
);

// Performance indexes for common queries
db.location_pings.createIndex({ "driver_id": 1, "recorded_at": -1 });
db.location_pings.createIndex({ "order_id": 1, "recorded_at": -1 });
```

Run these in MongoDB Shell (`mongosh`) or Compass.

### Redis

#### Production Configuration

When self-hosting Redis in production, apply these settings (already configured in `docker-compose.prod.yml`):

```conf
# Persistence
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Memory management
maxmemory 200mb
maxmemory-policy allkeys-lru

# Snapshots
save 900 1
save 300 10
save 60 10000
```

#### With Upstash (Managed)

No configuration needed. Just set `REDIS_URL` to the Upstash REST or connection string.

---

## Domain & SSL

### DNS Setup

Create A records pointing to your server's public IP:

| Record | Type | Value | TTL |
|--------|------|-------|-----|
| `api.truxify.com` | A | `<server-ip>` | 300 |
| `ml.truxify.com` | A | `<server-ip>` | 300 |
| `n8n.truxify.com` | A | `<server-ip>` | 300 |

### Reverse Proxy with Caddy (Recommended)

Caddy automatically provisions and renews SSL certificates via Let's Encrypt. Create `Caddyfile`:

```
api.truxify.com {
    reverse_proxy api:5000
}

ml.truxify.com {
    reverse_proxy ml-engine:8000
}

n8n.truxify.com {
    reverse_proxy n8n:5678
}
```

Run Caddy:

```bash
docker run -d \
  --name caddy \
  -p 80:80 \
  -p 443:443 \
  -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  --network truxify_prod \
  caddy:latest
```

### Alternative: Nginx + Certbot

**Step 1: Install Nginx**

```bash
sudo apt update
sudo apt install nginx
```

**Step 2: Configure Nginx sites**

Create `/etc/nginx/sites-available/api.truxify.com`:

```nginx
server {
    listen 80;
    server_name api.truxify.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # WebSocket support for live tracking
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Repeat for `ml.truxify.com` and `n8n.truxify.com`.

Enable sites:

```bash
sudo ln -s /etc/nginx/sites-available/api.truxify.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/ml.truxify.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/n8n.truxify.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Step 3: Obtain SSL certificates**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.truxify.com -d ml.truxify.com -d n8n.truxify.com
```

Certbot automatically configures auto-renewal via systemd timer.

---

## Monitoring & Maintenance

### Health Endpoints

Each service exposes a health check endpoint:

| Service | Endpoint | Expected Response |
|---------|----------|-------------------|
| API | `GET /api/health/live` | `{"status": "healthy"}` |
| API | `GET /health` | `{"status": "healthy", "service": "truxify-api", "uptime": ...}` |
| ML | `GET /health` | `{"status": "healthy", "service": "ml-engine", "models": {...}}` |
| n8n | `GET /healthz` | `{"status": "ok"}` |

### Logging

All services use structured JSON logging. View logs:

```bash
# All services
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 -f

# Specific service
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs api --tail=50 -f
```

### Sentry Error Tracking

Sentry is integrated into the API. To enable:

1. Create a project at [sentry.io](https://sentry.io)
2. Add `SENTRY_DSN` to your `.env`:

```env
SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
```

### Regular Maintenance Tasks

| Frequency | Task | Command |
|-----------|------|---------|
| Daily | Check disk usage | `df -h` |
| Weekly | Rotate Docker logs | `docker system prune --volumes` (review first) |
| Monthly | Update base images | `docker compose -f docker-compose.yml -f docker-compose.prod.yml build --pull` |
| Monthly | Database vacuum | `docker exec truxify-postgres psql -U postgres -d truxify -c "VACUUM ANALYZE;"` |
| Monthly | Review Sentry errors | Check [sentry.io](https://sentry.io) for new error patterns |

---

## Backup & Recovery

### What to Back Up

| Data | Location | Method |
|------|----------|--------|
| PostgreSQL | `postgres_data` volume | `pg_dump` |
| MongoDB | `mongo_data` volume | `mongodump` |
| Redis | `redis_data` volume | Optional (cache regenerates) |
| n8n workflows | `n8n_data` volume | `n8n export:workflow --all` |
| ML models | `ml_models_data` volume | File copy |
| Environment config | `.env` file | Secure copy (contains secrets) |

### Automated Backup Script

Create `scripts/backup_prod.sh`:

```bash
#!/bin/bash
# Production backup script — run via cron
# Usage: ./scripts/backup_prod.sh /path/to/backup/dir

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR/$TIMESTAMP"

# PostgreSQL
docker exec truxify-postgres pg_dump -U postgres truxify \
  | gzip > "$BACKUP_DIR/$TIMESTAMP/postgres.sql.gz"

# MongoDB
docker exec truxify-mongo mongodump \
  --db truxify_telemetry \
  --archive \
  | gzip > "$BACKUP_DIR/$TIMESTAMP/mongo.archive.gz"

# n8n workflows (requires n8n API key)
# docker exec truxify-n8n n8n export:workflow --all > "$BACKUP_DIR/$TIMESTAMP/n8n-workflows.json"

# n8n credentials (encrypted)
# docker exec truxify-n8n n8n export:credentials --all > "$BACKUP_DIR/$TIMESTAMP/n8n-credentials.json"

# Environment file (contains secrets — encrypt this)
cp .env "$BACKUP_DIR/$TIMESTAMP/.env"

echo "Backup completed: $BACKUP_DIR/$TIMESTAMP"
```

Add to crontab:

```bash
# Daily at 2 AM
0 2 * * * /path/to/Truxify/scripts/backup_prod.sh /mnt/backups
```

### Restoration

```bash
# PostgreSQL
gunzip -c backups/20260720_020000/postgres.sql.gz | docker exec -i truxify-postgres psql -U postgres truxify

# MongoDB
gunzip -c backups/20260720_020000/mongo.archive.gz | docker exec -i truxify-mongo mongorestore --archive

# Environment
cp backups/20260720_020000/.env .env
```

### Disaster Recovery

If the server is lost entirely:

1. Provision a new server (same OS)
2. Install Docker
3. Clone the repository
4. Restore `.env` from backup
5. Restore PostgreSQL and MongoDB from backup archives
6. Start the stack: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`

---

## Scaling Considerations

### Vertical Scaling

| Service | Bottleneck | Scale Up |
|---------|------------|----------|
| API | Node.js event loop | Increase `API_CPU_LIMIT` and `API_MEM_LIMIT` |
| ML Engine | Model inference CPU/RAM | Increase `ML_CPU_LIMIT` to 4+, `ML_MEM_LIMIT` to 2G+ |
| PostgreSQL | Connection count, query complexity | Increase `DB_MEM_LIMIT` (more shared_buffers) |
| MongoDB | Write throughput | Increase `MONGO_MEM_LIMIT` (more WiredTiger cache) |

### Horizontal Scaling

The API is stateless and can be scaled horizontally behind a load balancer:

```yaml
# docker-compose.prod.yml scaled block
api:
  # ... existing config ...
  deploy:
    replicas: 3
    resources:
      limits:
        cpus: "1"
        memory: "512M"
```

When scaling API horizontally, ensure:

- **PostgreSQL** connection pool is sized appropriately (multiply by replica count)
- **Redis** is shared across all replicas (single endpoint)
- **Rate limiter** uses Redis backend (not in-memory) to be consistent across replicas
- **WebSocket** connections are sticky (use `ip_hash` in Nginx/Caddy)

### ML Engine Scaling

The ML engine loads models into memory at startup. Scaling horizontally means each replica loads models independently, increasing total memory. Consider:

- Using a larger single node for ML (vertical scaling)
- Offloading training to a separate batch worker
- Using Redis as a model registry to share loaded models across replicas (requires code changes)

---

## Troubleshooting

### Container Startup Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `api` exits immediately | Missing `.env` variable | Check `docker compose logs api` for missing env errors |
| `api` crashes with `BYPASS_AUTH=true` in production | Security guard | Set `BYPASS_AUTH=false` or remove it from `.env` |
| `ml-engine` exits immediately | `ML_API_KEY` mismatch | Ensure same key is set in both `.env` and passed to ML service |
| `n8n` exits immediately | `N8N_ENCRYPTION_KEY` or `N8N_HOST` missing | Set both in `.env` |
| `db` won't start | Port 5432 already in use | Stop local PostgreSQL or change host port mapping |

### Connection Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| API can't reach ML engine | Wrong URL or network | Verify `ML_ENGINE_URL=http://ml-engine:8000` in compose |
| API can't reach MongoDB | Wrong connection string | Verify `MONGODB_URI` in `.env` |
| API can't reach Redis | Wrong connection string | Verify `REDIS_URL` in `.env` |
| Flutter app can't reach API | CORS or wrong URL | Verify `API_PUBLIC_URL` and CORS origins in `ml/main.py` |
| WebSocket connections fail | No sticky sessions | Configure `ip_hash` in reverse proxy for WS endpoints |

### Database Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `pg_isready` fails on startup | PostgreSQL still initializing | Wait 30-60 seconds for first startup |
| RLS policy not working | Wrong migration order | Run migrations in order (policies after schema) |
| MongoDB slow queries | Missing TTL index on `recorded_at` | Create index: `db.location_pings.createIndex({"recorded_at": 1})` |
| Redis memory full | `maxmemory-policy` not set | Use `allkeys-lru` eviction policy (configured in prod compose) |

### ML Engine Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `401 Unauthorized` from ML | `ML_API_KEY` mismatch | Verify both services share the same key |
| `503 Model not available` | Models not loaded | Check ML startup logs. First load may take 30+ seconds |
| Slow predictions | Resource contention | Increase `ML_CPU_LIMIT` and `ML_MEM_LIMIT` |

### n8n Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| n8n can't connect to PostgreSQL | Wrong DB credentials | Verify `DB_POSTGRESDB_PASSWORD` in `.env` |
| Workflow execution fails | API endpoint unreachable | Ensure n8n can reach `http://api:5000` |
| Credentials lost after restart | `N8N_ENCRYPTION_KEY` changed | Use the same key across restarts |

---

## Reference

- [Architecture Overview](architecture.md)
- [API Documentation](ml-api-schema.json)
- [Database Schema](schema.md)
- [Environment Setup](ENVIRONMENT_SETUP.md)
- [Contributing Guide](../CONTRIBUTING.md)
