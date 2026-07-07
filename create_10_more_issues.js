import { execSync } from 'child_process';

const issues = [
  {
    title: "perf(db): add composite indexes for geospatial queries in driver routes",
    body: "### Description\n`backend/api/src/routes/driverRoutes.js` likely performs geospatial queries to find nearby drivers. If the database collections do not have 2dsphere composite indexes (including status/availability), these queries will perform full collection scans under high load. Add proper composite indexes to improve query performance.\n\n### Files\n- `backend/api/src/routes/driverRoutes.js`\n- DB migration scripts\n\n### Type\nperformance"
  },
  {
    title: "feat(auth): implement refresh token rotation to mitigate token theft",
    body: "### Description\nThe current authentication flow in `authRoutes.js` does not invalidate old refresh tokens when a new one is issued (Refresh Token Rotation). If a refresh token is compromised, an attacker can maintain persistent access. Implement token rotation and a mechanism to revoke the token family if reuse is detected.\n\n### Files\n- `backend/api/src/routes/authRoutes.js`\n\n### Type\nsecurity"
  },
  {
    title: "fix(trucks): prevent race conditions in truck allocation logic",
    body: "### Description\nWhen a truck is assigned to a trip or driver in `truckRoutes.js`, there is a risk of a race condition if two requests are made simultaneously. This can result in a single truck being allocated to two different tasks. Implement pessimistic locking or atomic database updates to ensure exclusive allocation.\n\n### Files\n- `backend/api/src/routes/truckRoutes.js`\n\n### Type\nbug"
  },
  {
    title: "chore(ci): parallelize Vitest suites to speed up CI execution",
    body: "### Description\nThe GitHub Actions CI pipeline runs all Vitest test suites sequentially. As the codebase grows, this is becoming a bottleneck. Update the Vitest configuration and GitHub Actions workflow to run tests in parallel, significantly reducing CI run times.\n\n### Files\n- `.github/workflows/backend-ci.yml`\n- `backend/api/vitest.config.js`\n\n### Type\nchore"
  },
  {
    title: "feat(support): implement automated ticket assignment based on agent load",
    body: "### Description\nSupport tickets created via `supportRoutes.js` are currently unassigned or round-robined. Implement a load-based assignment system that checks the active ticket count for each support agent in Redis and assigns the new ticket to the least loaded available agent.\n\n### Files\n- `backend/api/src/routes/supportRoutes.js`\n- `backend/api/src/services/supportService.js`\n\n### Type\nfeature"
  },
  {
    title: "refactor(orders): break down massive orderRoutes.js into sub-controllers",
    body: "### Description\n`backend/api/src/routes/orderRoutes.js` has grown excessively large (~79kb), making it difficult to maintain and review. Refactor the file by moving the business logic into dedicated controllers (e.g., `OrderCreationController`, `OrderFulfillmentController`) and keep only route definitions in the routes file.\n\n### Files\n- `backend/api/src/routes/orderRoutes.js`\n- `backend/api/src/controllers/orderController.js`\n\n### Type\nrefactor"
  },
  {
    title: "fix(trips): calculate accurate ETA accounting for traffic data",
    body: "### Description\nThe trip ETA calculations in `tripRoutes.js` currently use raw distance and average speed, which is inaccurate during peak hours. Integrate a routing engine or maps API (like Google Maps Directions or OSRM) with traffic models to provide realistic ETA estimates.\n\n### Files\n- `backend/api/src/routes/tripRoutes.js`\n\n### Type\nbug"
  },
  {
    title: "security(devices): rate limit device registration endpoints to prevent spam",
    body: "### Description\nThe device registration logic in `deviceRoutes.js` lacks adequate rate limiting. Malicious actors could rapidly spam this endpoint, polluting the database with fake device tokens. Implement an IP-based and User-based rate limiter specifically for this route.\n\n### Files\n- `backend/api/src/routes/deviceRoutes.js`\n- `backend/api/src/middleware/rateLimiter.js`\n\n### Type\nsecurity"
  },
  {
    title: "test(auth): add integration tests for JWT token expiration and renewal",
    body: "### Description\nWe lack adequate automated tests verifying that expired JWT tokens are properly rejected and that the renewal flow (using refresh tokens) works seamlessly without causing interrupted user sessions. Add comprehensive integration tests covering these edge cases.\n\n### Files\n- `backend/api/test/integration/auth.test.js`\n\n### Type\ntest"
  },
  {
    title: "feat(health): add detailed component health checks for Supabase and Redis",
    body: "### Description\nThe current `/ready` endpoint only returns `{ status: 'ready' }`. Enhance `healthRoutes.js` to actively verify connections to the Supabase database and Redis instance, returning a detailed JSON response indicating the health of each dependent service.\n\n### Files\n- `backend/api/src/routes/healthRoutes.js`\n\n### Type\nfeature"
  }
];

for (const issue of issues) {
  console.log(`Creating issue: ${issue.title}`);
  try {
    const cmd = `gh issue create --title "${issue.title.replace(/"/g, '\\"')}" --body "${issue.body.replace(/"/g, '\\"')}"`;
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Failed to create issue: ${err.message}`);
  }
}
