# Backend API

Express service that powers the Truxify customer and driver apps. It integrates with Supabase, Redis, MongoDB, Firebase Auth, and supporting services.

## What It Does

- exposes REST endpoints for bookings, drivers, support, and tracking
- handles authentication and authorization
- coordinates delivery verification and escrow-related flows
- powers WebSocket updates for live tracking

## Develop

```bash
cp .env.example .env
npm install
npm run dev
```

## Local Database

You can start the local Postgres/PostGIS container with:

```bash
docker compose up -d db
```

## Environment Variables

Commonly required values for local development:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `MONGODB_URI`
- `REDIS_URL`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `TRUXIFY_API_BASE_URL`
- `DRIVER_LOGIN_PHONE`
- `DRIVER_LOGIN_OTP`

Refer to `.env.example` for the full set of available configuration values.

## Test

```bash
npm test
npm run test:unit
npm run test:integration
```

## 🚦 Load Testing

Load testing is performed using [k6](https://k6.io/).

### Prerequisites

- Install k6 (e.g., `brew install k6` or follow official OS installation guides).
- Ensure `BYPASS_AUTH=true` is set in `.env`.
- Run `npm run seed:dev` first so the dummy driver profile exists.

### Running Load Tests

- REST API load test (simulates traffic spike up to 500 VUs):
  ```bash
  npm run test:load:api
  ```
- WebSocket load test (simulates 100 sustained VUs sending GPS updates):
  ```bash
  npm run test:load:ws
  ```
Ensure `k6` is installed on your system (e.g., `brew install k6` or official k6 installation instructions).

Set `BYPASS_AUTH=true` in `.env` and execute the seeding command first to create the dummy driver profile:

```bash
npm run seed:dev
```

Run the load tests:

```bash
# REST API Load Test
npm run test:load:api

# WebSocket Load Test
npm run test:load:ws
```

## Notes

- The test suite uses an in-memory Supabase mock and does not require live services.
- The backend can be run independently for API development and testing.
- See `docs/wiki/Getting-Started-&-Local-Setup.md` for the full local setup guide.
