import { execSync } from 'child_process';

const issues = [
  {
    title: "fix(api): reject malformed numeric strings in load price and distance query filters",
    body: "### Description\n`parseFloat()` accepts numeric prefixes and silently ignores trailing text (e.g. `100abc` -> `100`). This causes invalid filters to be processed without error. Fix by validating that the raw string is a proper numeric value before parsing.\n\n### Files\n- `backend/api/src/routes/loadRoutes.js`\n\n### Type\nbug"
  },
  {
    title: "fix(profile): remove hardcoded test data fallback in profileService.js",
    body: "### Description\n`getProfile()`, `getCustomerStats()`, and `getDriverDetails()` return hardcoded test data when Supabase is unavailable. In production, this silently returns fake user data instead of failing. Fix by throwing an explicit error and update the test accordingly.\n\n### Files\n- `backend/api/src/services/profileService.js`\n- `backend/api/test/unit/profileService.test.js`\n\n### Type\nbug"
  },
  {
    title: "fix(tracker): reuse WebSocket Supabase Realtime channels by orderUUID to prevent leaks",
    body: "### Description\nEach location ping creates a new Supabase Realtime channel but only removes it on broadcast completion. Channels leak if the WebSocket closes mid-flight. Fix by caching channels per `orderUUID` in a Map, reusing them, and cleaning up on disconnect.\n\n### Files\n- `backend/api/src/sockets/tracker.js`\n\n### Type\nbug"
  },
  {
    title: "feat(profile): add admin cache invalidation endpoint for profile cache",
    body: "### Description\nProfile cache is only invalidated on self-initiated updates. Admin role changes made directly in Supabase don't invalidate the cache, causing stale permissions. Add `DELETE /admin/cache/:userId` endpoint for admin-initiated invalidation.\n\n### Files\n- `backend/api/src/routes/profileRoutes.js`\n- `backend/api/src/lib/profileCache.js`\n\n### Type\nfeature"
  },
  {
    title: "test(pricing): add unit tests for lib/pricing.js",
    body: "### Description\n`pricing.js` is a core pricing calculation helper with no unit tests. Add tests for `calculateBaseFreight`, `calculateTollEstimate`, `calculatePlatformFee`, and `calculateTotalAmount` using vitest.\n\n### Files\n- `backend/api/src/lib/pricing.js`\n- `backend/api/test/unit/pricing.test.js`\n\n### Type\ntest"
  },
  {
    title: "feat(logging): implement x-request-id propagation for distributed tracing",
    body: "### Description\nLogs currently lack a unique request ID, making it difficult to trace issues across asynchronous calls and multiple services. Add a middleware to generate or extract `x-request-id` and bind it to the logger context using `AsyncLocalStorage`.\n\n### Files\n- `backend/api/src/middleware/logger.js`\n- `backend/api/src/index.js`\n\n### Type\nfeature"
  },
  {
    title: "security(api): implement strict validation for pagination parameters to prevent memory exhaustion",
    body: "### Description\nEndpoints that use `limit` and `offset` do not strictly enforce a maximum limit. An attacker could request a massive `limit` (e.g., `limit=1000000`) causing excessive database load and memory exhaustion. Enforce a strict max limit of 100 on all paginated endpoints.\n\n### Files\n- `backend/api/src/middleware/pagination.js`\n\n### Type\nbug"
  },
  {
    title: "chore(db): implement graceful connection pool shutdown for MongoDB and Redis",
    body: "### Description\nDuring application shutdown, MongoDB and Redis connections are not explicitly closed, potentially leading to connection leaks and unclean terminations. Add cleanup handlers for `SIGINT` and `SIGTERM` to close the connection pools gracefully.\n\n### Files\n- `backend/api/src/config/db.js`\n- `backend/api/src/index.js`\n\n### Type\nchore"
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
