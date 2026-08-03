# Issue Candidates

1. Title: fix : add trust proxy configuration to Express app
   Type: fix
   Category: bug
   Files: backend/api/src/index.js
   Summary: Add `app.set('trust proxy', 1)` in Express bootstrap so per-IP rate limiters in rateLimiter.js correctly identify the end-client IP instead of the reverse proxy IP.
   Verification: `cd backend/api && npm run test:unit`
   Conflict risk: low

2. Title: fix : increase idempotency lock TTL from 10s to 120s
   Type: fix
   Category: bug
   Files: backend/api/src/middleware/idempotency.js
   Summary: The Redis PX 10000 (10s) lock TTL in idempotency.js is shorter than the maximum on-chain wait (60s in escrow.js). Increase to 120000ms so slow handlers cannot be re-entered by concurrent duplicates mid-execution.
   Verification: `cd backend/api && npm run test:unit`
   Conflict risk: low

3. Title: fix : add missing redisClient import to truckRoutes.js
   Type: fix
   Category: bug
   Files: backend/api/src/routes/truckRoutes.js
   Summary: Lines 483 and 485 use `redisClient` but it is not imported from `../config/db.js`, causing ESLint no-undef error. Add `redisClient` to the existing import statement.
   Verification: `cd backend/api && npm run test:unit && npx eslint backend/api/src/routes/truckRoutes.js --max-warnings 0`
   Conflict risk: low

4. Title: fix : remove duplicate supabaseAdmin import in orderLifecycleService.js
   Type: fix
   Category: bug
   Files: backend/api/src/services/order/orderLifecycleService.js
   Summary: Line 22 has a duplicate `import { supabaseAdmin } from '../../config/db.js'` that causes a parsing error. Remove the duplicate import.
   Verification: `cd backend/api && npm run test:unit && npx eslint backend/api/src/services/order/orderLifecycleService.js --max-warnings 0`
   Conflict risk: low

5. Title: test : add unit tests for pricing.js calculateDistanceAndDuration
   Type: test
   Category: test
   Files: backend/api/src/lib/pricing.js, backend/api/test/unit/lib/pricing.test.js
   Summary: The pricing.js module has no unit test file. Add unit tests for `calculateDistanceAndDuration` covering valid coordinates, NaN guards, and the OSRM null fallback.
   Verification: `cd backend/api && npm run test:unit`
   Conflict risk: low
