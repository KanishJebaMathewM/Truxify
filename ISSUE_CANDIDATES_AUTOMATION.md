# Issue Candidates

1. Title: fix : reject malformed numeric strings in load price and distance query filters
   Type: fix
   Category: bug
   Files: backend/api/src/routes/loadRoutes.js
   Summary: parseFloat() accepts numeric prefixes and silently ignores trailing text (e.g. "100abc" -> 100). Fix by validating that the raw string is a proper numeric value before parsing.
   Verification: npm run test:integration -- --reporter=default (loadOffers.test.js)
   Conflict risk: low

2. Title: fix : remove hardcoded test data fallback in profileService.js
   Type: fix
   Category: bug
   Files: backend/api/src/services/profileService.js, backend/api/test/unit/profileService.test.js
   Summary: getProfile(), getCustomerStats(), and getDriverDetails() return hardcoded test data when Supabase is unavailable. In production, this silently returns fake user data instead of failing. Fix by throwing an explicit error and update the test accordingly.
   Verification: npm run test:unit -- --reporter=default (profileService.test.js)
   Conflict risk: low

3. Title: fix : reuse WebSocket Supabase Realtime channels by orderUUID to prevent leaks
   Type: fix
   Category: bug
   Files: backend/api/src/sockets/tracker.js
   Summary: Each location ping creates a new Supabase Realtime channel but only removes it on broadcast completion. Channels leak if WebSocket closes mid-flight. Fix by caching channels per orderUUID in a Map, reusing them, and cleaning up on disconnect.
   Verification: npm run test:unit -- --reporter=default
   Conflict risk: low

4. Title: feat : add admin cache invalidation endpoint for profile cache
   Type: feat
   Category: feature
   Files: backend/api/src/routes/profileRoutes.js, backend/api/src/lib/profileCache.js
   Summary: Profile cache is only invalidated on self-initiated updates. Admin role changes made directly in Supabase don't invalidate cache, causing stale permissions. Add DELETE /admin/cache/:userId endpoint for admin-initiated invalidation.
   Verification: npm run test:unit -- --reporter=default
   Conflict risk: low

5. Title: test : add unit tests for lib/pricing.js
   Type: test
   Category: test
   Files: backend/api/src/lib/pricing.js, backend/api/test/unit/pricing.test.js
   Summary: pricing.js is a core pricing calculation helper with no unit tests. Add tests for calculateBaseFreight, calculateTollEstimate, calculatePlatformFee, and calculateTotalAmount using vitest.
   Verification: npm run test:unit -- --reporter=default (pricing.test.js)
   Conflict risk: low
