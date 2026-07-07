import { execSync } from 'child_process';
import fs from 'fs';

const issues = [
  // 8 issues from the first batch
  {
    number: 2043,
    title: "fix(api): reject malformed numeric strings in load price and distance query filters",
    body: "### Description\n`parseFloat()` accepts numeric prefixes and silently ignores trailing text (e.g. `100abc` -> `100`). This causes invalid filters to be processed without error. Fix by validating that the raw string is a proper numeric value before parsing.\n\n### Files\n- `backend/api/src/routes/loadRoutes.js`\n\n### Type\nbug"
  },
  {
    number: 2044,
    title: "fix(profile): remove hardcoded test data fallback in profileService.js",
    body: "### Description\n`getProfile()`, `getCustomerStats()`, and `getDriverDetails()` return hardcoded test data when Supabase is unavailable. In production, this silently returns fake user data instead of failing. Fix by throwing an explicit error and update the test accordingly.\n\n### Files\n- `backend/api/src/services/profileService.js`\n- `backend/api/test/unit/profileService.test.js`\n\n### Type\nbug"
  },
  {
    number: 2045,
    title: "fix(tracker): reuse WebSocket Supabase Realtime channels by orderUUID to prevent leaks",
    body: "### Description\nEach location ping creates a new Supabase Realtime channel but only removes it on broadcast completion. Channels leak if the WebSocket closes mid-flight. Fix by caching channels per `orderUUID` in a Map, reusing them, and cleaning up on disconnect.\n\n### Files\n- `backend/api/src/sockets/tracker.js`\n\n### Type\nbug"
  },
  {
    number: 2046,
    title: "feat(profile): add admin cache invalidation endpoint for profile cache",
    body: "### Description\nProfile cache is only invalidated on self-initiated updates. Admin role changes made directly in Supabase don't invalidate the cache, causing stale permissions. Add `DELETE /admin/cache/:userId` endpoint for admin-initiated invalidation.\n\n### Files\n- `backend/api/src/routes/profileRoutes.js`\n- `backend/api/src/lib/profileCache.js`\n\n### Type\nfeature"
  },
  {
    number: 2047,
    title: "test(pricing): add unit tests for lib/pricing.js",
    body: "### Description\n`pricing.js` is a core pricing calculation helper with no unit tests. Add tests for `calculateBaseFreight`, `calculateTollEstimate`, `calculatePlatformFee`, and `calculateTotalAmount` using vitest.\n\n### Files\n- `backend/api/src/lib/pricing.js`\n- `backend/api/test/unit/pricing.test.js`\n\n### Type\ntest"
  },
  {
    number: 2048,
    title: "feat(logging): implement x-request-id propagation for distributed tracing",
    body: "### Description\nLogs currently lack a unique request ID, making it difficult to trace issues across asynchronous calls and multiple services. Add a middleware to generate or extract `x-request-id` and bind it to the logger context using `AsyncLocalStorage`.\n\n### Files\n- `backend/api/src/middleware/logger.js`\n- `backend/api/src/index.js`\n\n### Type\nfeature"
  },
  {
    number: 2049,
    title: "security(api): implement strict validation for pagination parameters to prevent memory exhaustion",
    body: "### Description\nEndpoints that use `limit` and `offset` do not strictly enforce a maximum limit. An attacker could request a massive `limit` (e.g., `limit=1000000`) causing excessive database load and memory exhaustion. Enforce a strict max limit of 100 on all paginated endpoints.\n\n### Files\n- `backend/api/src/middleware/pagination.js`\n\n### Type\nbug"
  },
  {
    number: 2050,
    title: "chore(db): implement graceful connection pool shutdown for MongoDB and Redis",
    body: "### Description\nDuring application shutdown, MongoDB and Redis connections are not explicitly closed, potentially leading to connection leaks and unclean terminations. Add cleanup handlers for `SIGINT` and `SIGTERM` to close the connection pools gracefully.\n\n### Files\n- `backend/api/src/config/db.js`\n- `backend/api/src/index.js`\n\n### Type\nchore"
  },
  // 10 issues from the second batch
  {
    number: 2051,
    title: "perf(db): add composite indexes for geospatial queries in driver routes",
    body: "### Description\n`backend/api/src/routes/driverRoutes.js` likely performs geospatial queries to find nearby drivers. If the database collections do not have 2dsphere composite indexes (including status/availability), these queries will perform full collection scans under high load. Add proper composite indexes to improve query performance.\n\n### Files\n- `backend/api/src/routes/driverRoutes.js`\n- DB migration scripts\n\n### Type\nperformance"
  },
  {
    number: 2052,
    title: "feat(auth): implement refresh token rotation to mitigate token theft",
    body: "### Description\nThe current authentication flow in `authRoutes.js` does not invalidate old refresh tokens when a new one is issued (Refresh Token Rotation). If a refresh token is compromised, an attacker can maintain persistent access. Implement token rotation and a mechanism to revoke the token family if reuse is detected.\n\n### Files\n- `backend/api/src/routes/authRoutes.js`\n\n### Type\nsecurity"
  },
  {
    number: 2053,
    title: "fix(trucks): prevent race conditions in truck allocation logic",
    body: "### Description\nWhen a truck is assigned to a trip or driver in `truckRoutes.js`, there is a risk of a race condition if two requests are made simultaneously. This can result in a single truck being allocated to two different tasks. Implement pessimistic locking or atomic database updates to ensure exclusive allocation.\n\n### Files\n- `backend/api/src/routes/truckRoutes.js`\n\n### Type\nbug"
  },
  {
    number: 2054,
    title: "chore(ci): parallelize Vitest suites to speed up CI execution",
    body: "### Description\nThe GitHub Actions CI pipeline runs all Vitest test suites sequentially. As the codebase grows, this is becoming a bottleneck. Update the Vitest configuration and GitHub Actions workflow to run tests in parallel, significantly reducing CI run times.\n\n### Files\n- `.github/workflows/backend-ci.yml`\n- `backend/api/vitest.config.js`\n\n### Type\nchore"
  },
  {
    number: 2055,
    title: "feat(support): implement automated ticket assignment based on agent load",
    body: "### Description\nSupport tickets created via `supportRoutes.js` are currently unassigned or round-robined. Implement a load-based assignment system that checks the active ticket count for each support agent in Redis and assigns the new ticket to the least loaded available agent.\n\n### Files\n- `backend/api/src/routes/supportRoutes.js`\n- `backend/api/src/services/supportService.js`\n\n### Type\nfeature"
  },
  {
    number: 2056,
    title: "refactor(orders): break down massive orderRoutes.js into sub-controllers",
    body: "### Description\n`backend/api/src/routes/orderRoutes.js` has grown excessively large (~79kb), making it difficult to maintain and review. Refactor the file by moving the business logic into dedicated controllers (e.g., `OrderCreationController`, `OrderFulfillmentController`) and keep only route definitions in the routes file.\n\n### Files\n- `backend/api/src/routes/orderRoutes.js`\n- `backend/api/src/controllers/orderController.js`\n\n### Type\nrefactor"
  },
  {
    number: 2057,
    title: "fix(trips): calculate accurate ETA accounting for traffic data",
    body: "### Description\nThe trip ETA calculations in `tripRoutes.js` currently use raw distance and average speed, which is inaccurate during peak hours. Integrate a routing engine or maps API (like Google Maps Directions or OSRM) with traffic models to provide realistic ETA estimates.\n\n### Files\n- `backend/api/src/routes/tripRoutes.js`\n\n### Type\nbug"
  },
  {
    number: 2058,
    title: "security(devices): rate limit device registration endpoints to prevent spam",
    body: "### Description\nThe device registration logic in `deviceRoutes.js` lacks adequate rate limiting. Malicious actors could rapidly spam this endpoint, polluting the database with fake device tokens. Implement an IP-based and User-based rate limiter specifically for this route.\n\n### Files\n- `backend/api/src/routes/deviceRoutes.js`\n- `backend/api/src/middleware/rateLimiter.js`\n\n### Type\nsecurity"
  },
  {
    number: 2059,
    title: "test(auth): add integration tests for JWT token expiration and renewal",
    body: "### Description\nWe lack adequate automated tests verifying that expired JWT tokens are properly rejected and that the renewal flow (using refresh tokens) works seamlessly without causing interrupted user sessions. Add comprehensive integration tests covering these edge cases.\n\n### Files\n- `backend/api/test/integration/auth.test.js`\n\n### Type\ntest"
  },
  {
    number: 2060,
    title: "feat(health): add detailed component health checks for Supabase and Redis",
    body: "### Description\nThe current `/ready` endpoint only returns `{ status: 'ready' }`. Enhance `healthRoutes.js` to actively verify connections to the Supabase database and Redis instance, returning a detailed JSON response indicating the health of each dependent service.\n\n### Files\n- `backend/api/src/routes/healthRoutes.js`\n\n### Type\nfeature"
  }
];

const tempFile = 'temp_body.md';

for (const issue of issues) {
  console.log(`Updating issue #${issue.number}`);
  try {
    fs.writeFileSync(tempFile, issue.body, 'utf8');
    const cmd = `gh issue edit ${issue.number} --body-file ${tempFile}`;
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Failed to update issue #${issue.number}: ${err.message}`);
  }
}

if (fs.existsSync(tempFile)) {
  fs.unlinkSync(tempFile);
}
