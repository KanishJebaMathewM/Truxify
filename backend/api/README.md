# Backend API

Express service that powers the Truxify customer and driver apps. It integrates with Supabase, Redis, MongoDB, Firebase Auth, and supporting services.

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

## Test

```bash
npm test
npm run test:unit
npm run test:integration
```

## Notes

- The test suite uses an in-memory Supabase mock and does not require live services.
- See `docs/wiki/Getting-Started-&-Local-Setup.md` for the full local setup guide.
