# Backend API

Express service that powers the Truxify customer + driver apps, talking to
Supabase (Postgres), MongoDB Atlas (telemetry), Redis (caching) and Firebase
Auth.

## Develop

```bash
cp .env.example .env   # fill in credentials
npm install
npm run dev            # nodemon + node src/index.js
```

## Test

Vitest + supertest. No live Supabase / Redis / MongoDB required — the test
suite uses an in-memory Supabase mock (`test/helpers/supabaseMock.js`) and
sets `BYPASS_AUTH=true` via `test/setup.js` so requests can inject identity
through `x-user-id` / `x-user-role` headers.

```bash
npm test                  # full suite (unit + integration)
npm run test:unit         # pricing math + env-var overrides
npm run test:integration  # orders route server-side-pricing contract
npm run test:coverage     # v8 coverage report in coverage/
```

## Endpoints

| Method | Path                      | Role required |
| ------ | ------------------------- | ------------- |
| POST   | `/api/orders`             | customer      |
| GET    | `/api/orders/mine`        | customer      |
| GET    | `/api/orders/:id`         | customer/driver |
| POST   | `/api/orders/:id/cancel`  | customer      |
| POST   | `/api/orders/:id/bid`     | driver        |
| POST   | `/api/orders/:id/accept`  | customer      |
| GET    | `/api/orders/available`   | driver        |

## Pricing

All monetary fields on `orders` and `load_offers` are server-computed by
`src/lib/pricing.js`. Client-supplied `base_freight`, `toll_estimate`,
`platform_fee`, and `total_amount` are ignored — the server's number is the
only number persisted. See `src/lib/pricing.js` for the rate card.
