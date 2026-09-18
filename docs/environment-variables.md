# Environment Variables Reference

This document lists configuration used by the Truxify backend API (`backend/api/`) and identifies shared/root-level variables used by Docker Compose and the Flutter applications. Keep the root `.env.example` and component-specific `.env.example` files as the concrete configuration templates.

> **Source of truth:** configuration names should match the current application source and the checked-in `.env.example` files. Older names such as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` must not be introduced in new deployments; the current root template uses `REDIS_REST_URL` and `REDIS_REST_TOKEN`.

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_URL` | Yes | - | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | - | Supabase anonymous (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | - | Supabase service role key (admin access) |
| `DATABASE_URL` | - | - | PostgreSQL connection string (alternative to Supabase) |
| `REDIS_URL` | - | - | Redis connection string for caching and pub/sub |
| `MONGODB_URI` | - | - | MongoDB connection URI for telemetry/event storage |
| `MONGODB_DB_NAME` | - | `truxify_telemetry` | MongoDB database name |

## Supabase Retry / Resilience

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_RETRY_MAX_RETRIES` | - | `3` | Max retries for Supabase RPC calls |
| `SUPABASE_RETRY_BASE_DELAY_MS` | - | `1000` | Base delay for exponential backoff (ms) |
| `SUPABASE_RETRY_MAX_DELAY_MS` | - | `10000` | Max delay between retries (ms) |

## Authentication

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | Yes | - | Secret for signing and verifying JWTs |
| `BYPASS_AUTH` | - | `false` | Set to `true` to skip auth in development |
| `ENABLE_TEST_AUTH` | - | `false` | Enable test authentication endpoints |
| `DEV_ACCESS_TOKEN` | - | - | Development-only access token |
| `TRUXIFY_API_BASE_URL` | - | `http://localhost:5000` | Backend base URL used by Flutter apps |

## Blockchain / Escrow

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | Yes | - | Wallet private key for signing transactions |
| `RELAYER_WALLET_PRIVATE_KEY` | - | - | Relayer wallet private key for gasless transactions |
| `ESCROW_CONTRACT_ADDRESS` | - | - | TruxifyEscrow smart contract address on Polygon |
| `REPUTATION_CONTRACT_ADDRESS` | - | - | Reputation contract address |
| `KYC_VERIFIER_CONTRACT_ADDRESS` | - | - | KYC verifier contract address |
| `DOCUMENT_REGISTRY_CONTRACT` | - | - | Document registry contract address |
| `MAX_ESCROW_MATIC` | - | `250000` | Max MATIC per escrow deposit (paisa converted) |
| `ESCROW_MATIC_PER_PAISA` | - | `0.00025` | MATIC to paisa conversion rate |
| `POLYGON_RPC_URL` | - | - | Polygon RPC node URL |
| `POLYGON_RPC_NODES` | - | - | Comma-separated list of Polygon RPC URLs |
| `ESCROW_RELEASE_CONFIRMATIONS` | - | `1` | Required confirmations for escrow-release webhook validation |
| `ESCROW_VERIFICATION_RPC_TIMEOUT_MS` | - | `10000` | Timeout for escrow verification RPC calls |

## ML Service

| Variable | Required | Default | Description |
|---|---|---|---|
| `ML_API_KEY` | Yes | - | API key for ML engine endpoints |
| `ML_ENGINE_URL` | - | `http://localhost:8001` | Base URL for the ML inference service |
| `ML_SERVICE_URL` | - | - | Alternative ML service URL |

## OSRM Routing

| Variable | Required | Default | Description |
|---|---|---|---|
| `OSRM_URL` | - | `http://router.project-osrm.org` | OSRM routing server URL |
| `OSRM_BASE_URL` | - | - | Alternative OSRM base URL |
| `OSRM_TIMEOUT_MS` | - | `5000` | Timeout for OSRM requests (ms) |
| `OSRM_MAX_RETRIES` | - | `3` | Max retries for OSRM requests |
| `OSRM_RETRY_BASE_DELAY_MS` | - | `500` | Base delay for OSRM retries (ms) |
| `ROUTING_API_KEY` | - | - | External routing provider key where configured |

## Pricing Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `TRUXIFY_RATE_PER_TONNE_KM` | - | `50` | Base rate per tonne-km (paisa) |
| `TRUXIFY_PLATFORM_FEE_PCT` | - | `5` | Platform fee percentage |
| `TRUXIFY_FUEL_COST_PCT` | - | `45` | Fuel cost as % of base freight |
| `TRUXIFY_TOLL_PER_KM` | - | `200` | Toll cost per km (paisa) |
| `TRUXIFY_HANDLING_FEE` | - | `30000` | Fixed handling fee (paisa) |
| `TRUXIFY_FRAGILE_MULTIPLIER` | - | `1.5` | Rate multiplier for fragile cargo |
| `TRUXIFY_STACKABLE_DISCOUNT` | - | `0.9` | Rate discount for stackable loads |

## Rate Limiting

| Variable | Required | Default | Description |
|---|---|---|---|
| `GLOBAL_RATE_LIMIT_MAX_REQUESTS` | - | `100` | Max requests per window |
| `GLOBAL_RATE_LIMIT_WINDOW_MS` | - | `60000` | Rate limit window (ms) |
| `USER_RATE_LIMIT_MAX_REQUESTS` | - | `100` | Per-user rate limit |
| `USER_RATE_LIMIT_WINDOW_MS` | - | `60000` | User rate limit window |
| `ADMIN_RATE_LIMIT_MAX_REQUESTS` | - | `1000` | Admin endpoint rate limit |
| `ADMIN_RATE_LIMIT_WINDOW_MS` | - | `60000` | Admin rate limit window |
| `DEVICE_RATE_LIMIT_MAX_REQUESTS` | - | `100` | Device endpoint rate limit |
| `DEVICE_RATE_LIMIT_WINDOW_MS` | - | `60000` | Device rate limit window |
| `HEALTH_RATE_LIMIT_MAX_REQUESTS` | - | `60` | Health check rate limit |
| `HEALTH_RATE_LIMIT_WINDOW_MS` | - | `60000` | Health rate limit window |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | - | `10` | Auth endpoint rate limit |
| `AUTH_RATE_LIMIT_WINDOW_MS` | - | `60000` | Auth rate limit window |
| `OTP_VERIFICATION_RATE_LIMIT_MAX_REQUESTS` | - | `5` | OTP verification rate limit |
| `OTP_VERIFICATION_RATE_LIMIT_WINDOW_MS` | - | `300000` | OTP verification window |
| `ZKP_RATE_LIMIT_MAX` | - | `50` | ZKP endpoint rate limit |
| `ZKP_RATE_LIMIT_WINDOW_MS` | - | `60000` | ZKP rate limit window |

## Monitoring / Observability

| Variable | Required | Default | Description |
|---|---|---|---|
| `SENTRY_DSN` | - | - | Sentry DSN for error tracking |
| `SENTRY_TRACES_SAMPLE_RATE` | - | `0.1` | Sentry trace sample rate |
| `LOG_LEVEL` | - | `info` | Log level (debug, info, warn, error) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | - | - | OpenTelemetry collector endpoint |
| `SLOW_OPERATION_THRESHOLD_MS` | - | `5000` | Threshold for slow operation logging |
| `METRICS_COLLECTION_INTERVAL_MS` | - | `60000` | Metrics collection interval |

## OTP / Authentication

| Variable | Required | Default | Description |
|---|---|---|---|
| `OTP_TTL_MINUTES` | - | `5` | OTP validity window (minutes) |
| `OTP_MAX_FAILED_ATTEMPTS` | - | `5` | Max failed OTP attempts before lockout |
| `OTP_LOCKOUT_MINUTES` | - | `15` | Lockout duration after max failures |
| `DRIVER_LOGIN_OTP` | - | `false` | Enable OTP-based driver login |
| `AUTH_FAILURE_THRESHOLD` | - | `10` | Failed auth attempts before rate limit |
| `AUTH_FAILURE_WINDOW_MS` | - | `300000` | Auth failure tracking window |

## FCM / Push Notifications

| Variable | Required | Default | Description |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | - | - | Firebase service account JSON for FCM |
| `FIREBASE_PROJECT_ID` | - | - | Firebase project identifier |
| `FIREBASE_API_KEY` | - | - | Firebase client API key where required |
| `FIREBASE_MESSAGING_SENDER_ID` | - | - | Firebase Cloud Messaging sender ID |
| `FIREBASE_CUSTOMER_APP_ID` | - | - | Customer app Firebase application ID |
| `FIREBASE_DRIVER_APP_ID` | - | - | Driver app Firebase application ID |
| `FIREBASE_STORAGE_BUCKET` | - | - | Firebase storage bucket |
| `FIREBASE_AUTH_DOMAIN` | - | - | Firebase authentication domain |
| `FIREBASE_CLIENT_EMAIL` | - | - | Firebase service account client email |
| `FIREBASE_PRIVATE_KEY` | - | - | Firebase service account private key |

## External APIs

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | - | - | OpenAI API key for AI features |
| `TOMTOM_API_KEY` | - | - | TomTom API key for location services |
| `TWILIO_AUTH_TOKEN` | - | - | Twilio auth token for SMS |
| `ELEVENLABS_API_KEY` | - | - | ElevenLabs API key for voice/TTS |
| `ELEVENLABS_VOICE_ID` | - | - | Default ElevenLabs voice ID |
| `CLAMAV_HOST` | - | - | ClamAV antivirus host |
| `CLAMAV_UNAVAILABLE_ACTION` | - | `allow` | Action when ClamAV is unavailable |

## Storage / CDN

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_ACCESS_KEY` | - | - | AWS access key for S3 uploads |
| `AWS_SECRET_KEY` | - | - | AWS secret key |
| `AZURE_CONNECTION_STRING` | - | - | Azure Blob Storage connection string |
| `GCP_PROJECT_ID` | - | - | Google Cloud project ID |
| `R2_ACCOUNT_ID` | - | - | Cloudflare R2 account identifier |
| `R2_ACCESS_KEY_ID` | - | - | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | - | - | Cloudflare R2 secret key |
| `R2_BUCKET_NAME` | - | - | Cloudflare R2 bucket |
| `R2_PUBLIC_URL_PREFIX` | - | - | Public URL prefix for R2 assets |

## Server Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | - | `3000` | HTTP server port |
| `NODE_ENV` | - | `development` | Environment (development, production) |
| `ALLOWED_ORIGINS` | - | - | Comma-separated list of allowed CORS origins |
| `HOSTNAME` | - | - | Server hostname |
| `PUBLIC_BASE_URL` | - | - | Public base URL for the API |
| `API_PUBLIC_URL` | - | - | Alternative public API URL |
| `TRUST_PROXY` | - | `true` | Trust X-Forwarded-* headers from reverse proxy |
| `HEADER_SIZE_LIMIT` | - | `16384` | Max HTTP header size (bytes) |
| `JSON_BODY_LIMIT` | - | `1mb` | Max JSON request body size |
| `URLENCODED_BODY_LIMIT` | - | `1mb` | Max URL-encoded body size |
| `MULTIPART_FILE_LIMIT_BYTES` | - | `10485760` | Max multipart file size (10 MB) |

## Reconciliation Workers

| Variable | Required | Default | Description |
|---|---|---|---|
| `ESCROW_FUNDING_RECONCILIATION_INTERVAL_MS` | - | `300000` | Escrow funding check interval (ms) |
| `ESCROW_RELEASE_RECONCILIATION_INTERVAL_MS` | - | `300000` | Escrow release reconciliation interval |
| `ESCROW_RECONCILIATION_INTERVAL_MS` | - | `300000` | General escrow reconciliation interval |
| `REPUTATION_RECONCILIATION_INTERVAL_MS` | - | `3600000` | Reputation reconciliation interval |
| `DOCUMENT_EXPIRY_WORKER_INTERVAL_MS` | - | `86400000` | Document expiry check interval |
| `BLOCKCHAIN_POLL_INTERVAL_MS` | - | `30000` | Blockchain event polling interval |
| `DIVERGENCE_CHECK_INTERVAL_MS` | - | `300000` | State divergence check interval |

## Misc / Optional

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_VERSION` | - | - | App version string |
| `PUBLIC_TRACKING_URL` | Required in production | `https://track.example.com` | Fixed public origin for customer tracking links. The API never falls back to the request Host header. |
| `PLATFORM_UPI_ID` | - | - | Platform UPI ID for payments |
| `UPI_GATEWAY` | - | - | UPI gateway URL |
| `FRAUD_THRESHOLD` | - | `0.8` | Fraud detection score threshold |
| `BEHAVIORAL_ANALYTICS_ENABLED` | - | `true` | Enable behavioral analytics |
| `NETWORK_ANALYSIS_ENABLED` | - | `true` | Enable network analysis |
| `CHAINLINK_ENABLED` | - | `false` | Enable Chainlink oracle integration |
| `BACKUP_ORACLE_ENABLED` | - | `false` | Enable backup oracle |
| `KAFKA_ENABLED` | - | `false` | Enable Kafka event streaming |
| `KAFKA_BROKERS` | - | - | Comma-separated Kafka broker list |
| `WEBRTC_ENABLED` | - | `true` | Enable WebSocket tracking |
| `CACHE_ENABLED` | - | `true` | Enable Redis caching |
| `REDIS_CACHE_TTL` | - | `3600` | Default Redis cache TTL (seconds) |
| `IDEMPOTENCY_LOCK_TTL_MS` | - | `60000` | Idempotency lock TTL (ms) |
| `RECOVERY_FILE_PATH` | - | `/tmp/truxify_recovery.json` | Telemetry recovery file path |
| `COMPRESSION_ENABLED` | - | `true` | Enable response compression |
| `COMPRESSION_THRESHOLD_BYTES` | - | `1024` | Min response size for compression |
| `COMPRESSION_LEVEL` | - | `6` | gzip compression level (1-9) |

## Root `.env.example` / Docker Compose Variables

The root `.env.example` also contains values consumed by Docker Compose and the Flutter applications. These are intentionally separated from API-only settings so contributors do not confuse service-local configuration with client build configuration.

### Local database/container credentials

| Variable | Purpose |
|---|---|
| `POSTGRES_USER` | PostgreSQL container user |
| `POSTGRES_PASSWORD` | PostgreSQL container password |
| `POSTGRES_DB` | PostgreSQL database name |
| `DB_PASSWORD` | Primary database service password |
| `SHARD_PASSWORD` | Shared password for geographic database shards |
| `MONGO_ROOT_USER` | MongoDB container root user |
| `MONGO_ROOT_PASSWORD` | MongoDB container root password |
| `REDIS_PASSWORD` | Redis `requirepass` value |
| `LOCAL_DATABASE_URL` | Direct host-side PostgreSQL connection string |

### Redis / cache

| Variable | Purpose |
|---|---|
| `REDIS_REST_URL` | Redis REST endpoint for HTTP clients |
| `REDIS_REST_TOKEN` | Redis REST authentication token |

### n8n automation

| Variable | Purpose |
|---|---|
| `N8N_ENCRYPTION_KEY` | n8n encryption key |
| `N8N_USER_MANAGEMENT_JWT_SECRET` | n8n authentication secret |
| `N8N_DB_PASSWORD` | Password for the dedicated n8n database |
| `BACKEND_API_URL` | API URL reachable from the n8n container |
| `ADMIN_ALERT_EMAIL` | Operator mailbox for dispute/escalation alerts |

### Production guidance

Never copy placeholder credentials into a production deployment. Keep `.env` files out of source control, use runtime secrets for private keys/API tokens, and keep the variable names in this document synchronized with `.env.example` and component-specific examples.
