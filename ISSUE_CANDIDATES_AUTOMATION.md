# Issue Candidates

1. Title: test : fix bidAcceptanceService.test.js mock method name mismatch
   Type: test
   Category: test
   Files: backend/api/test/unit/bidAcceptanceService.test.js
   Summary: Test mocks findOrderByIdOrDisplayId but service calls findOrderById - fix mock to match service.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

2. Title: test : fix sentry.test.js mock missing Handlers export
   Type: test
   Category: test
   Files: backend/api/test/unit/sentry.test.js
   Summary: @sentry/node mock omits Handlers export, throwing on the optional-chained probe - add missing mock.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

3. Title: test : fix voiceService.test.js mock missing supabaseAdmin
   Type: test
   Category: test
   Files: backend/api/test/unit/services/voiceService.test.js
   Summary: config/db.js mock omits supabaseAdmin causing module-load crash in tests.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

4. Title: test : fix redisLock.test.js wrong import paths
   Type: test
   Category: test
   Files: backend/api/test/unit/redisLock.test.js
   Summary: Test imports at wrong depth and asserts pre-fail-closed contract instead of current behavior.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

5. Title: test : fix anomalyDetectionService.test.js mock and assertions
   Type: test
   Category: test
   Files: backend/api/test/unit/anomalyDetectionService.test.js
   Summary: Mock omits supabaseAdmin and asserts stale transactions table - fix both.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

6. Title: test : fix healthAggregation.test.js mock missing supabaseAdmin
   Type: test
   Category: test
   Files: backend/api/test/unit/healthAggregation.test.js
   Summary: config/db.js mock omits supabaseAdmin causing /api/health/full to always 503.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

7. Title: test : fix maintenancePhotoRoutes.test.js mock missing createUserClient
   Type: test
   Category: test
   Files: backend/api/test/unit/maintenancePhotoRoutes.test.js
   Summary: Mock omits createUserClient causing every upload to return 500.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

8. Title: test : fix escrowRebalance.test.js stale BigInt wrapper assertion
   Type: test
   Category: test
   Files: backend/api/test/unit/changeDrop.escrowRebalance.test.js
   Summary: Test asserts BigInt wrapper that no longer exists in orderRoutes.js after refactor.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

9. Title: test : fix routingService.test.js toBe reference vs toEqual value
   Type: test
   Category: test
   Files: backend/api/test/unit/routingService.test.js
   Summary: Single-waypoint test uses strict toBe reference assertion vs defensive copy returned by service.
   Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
   Conflict risk: low

10. Title: test : fix mlService.test.js regex order for error context
    Type: test
    Category: test
    Files: backend/api/test/unit/mlService.test.js
    Summary: Tests require METHOD ... url ... status regex order but handleResponse emits status/label ... for METHOD url.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

11. Title: test : fix trafficService.test.js surge without API key
    Type: test
    Category: test
    Files: backend/api/test/unit/trafficService.test.js
    Summary: Tests expect rush-hour surge without API key but service fails open to 1.0 when no traffic key is configured.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

12. Title: bug : fix driver app.dart garbled nested MaterialApp code
    Type: fix
    Category: bug
    Files: apps/driver/lib/app.dart
    Summary: app.dart has garbled code with nested MaterialApp and missing braces causing build failure.
    Verification: cd apps/driver && flutter pub get && flutter analyze
    Conflict risk: low

13. Title: bug : fix driver main.dart duplicate imports and unreachable runApp
    Type: fix
    Category: bug
    Files: apps/driver/lib/main.dart
    Summary: main.dart has duplicate imports and calls runApp twice with the second being unreachable.
    Verification: cd apps/driver && flutter pub get && flutter analyze
    Conflict risk: low

14. Title: fix : remove headerSizeMonitor production skip and return 431
    Type: fix
    Category: fix
    Files: backend/api/src/middleware/headerSizeMonitor.js
    Summary: headerSizeMonitor skips monitoring entirely in production and only warns instead of returning 431.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

15. Title: fix : add Secure to cookieSecurityValidator RECOMMENDED_ATTRIBUTES
    Type: fix
    Category: fix
    Files: backend/api/src/middleware/cookieSecurityValidator.js
    Summary: RECOMMENDED_ATTRIBUTES omits Secure flag required for HTTPS cookies in production.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

16. Title: fix : notificationService logger.error uses strings not structured objects
    Type: fix
    Category: fix
    Files: backend/api/src/services/notificationService.js
    Summary: Multiple logger.error calls use string interpolation instead of structured logging pattern.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

17. Title: fix : notificationService returns success true when Firebase not configured
    Type: fix
    Category: fix
    Files: backend/api/src/services/notificationService.js
    Summary: sendPushNotification returns success true even when supabaseAdmin is not configured.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

18. Title: fix : auth logout response hardcodes cacheInvalidated true on failure
    Type: fix
    Category: fix
    Files: backend/api/src/routes/authRoutes.js
    Summary: POST /api/auth/logout always returns cacheInvalidated true even when Redis invalidation fails.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

19. Title: test : add unit tests for cookieSecurityValidator middleware
    Type: test
    Category: test
    Files: backend/api/test/unit/cookieSecurityValidator.test.js
    Summary: cookieSecurityValidator has no unit tests - add coverage for validateCookies function.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low

20. Title: fix : errorHandler reads err.errors but zod v4 uses err.issues
    Type: fix
    Category: fix
    Files: backend/api/src/middleware/errorHandler.js
    Summary: errorHandler reads err.errors for ZodError but zod v4 removed this property - use err.issues instead.
    Verification: cd backend/api && npm ci && npm run test:unit -- --reporter=default
    Conflict risk: low
