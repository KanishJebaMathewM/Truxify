import subprocess

issues = [
    {
        "title": "refactor(tracker): Move WebSocket connection state management to Redis for horizontal scalability",
        "body": "### Description\nCurrently, `tracker.js` stores active client subscriptions and location channels in memory (`trackingSubscriptions` and `locationChannels` Maps). This prevents the WebSocket server from scaling horizontally across multiple Node.js instances because subscriptions are local to each process. Moving this state to Redis using Pub/Sub will allow seamless broadcasting across a cluster.\n\n### Expected Behavior\n- Replace in-memory Maps with Redis Pub/Sub.\n- Broadcasting a location update reaches clients connected to any server instance."
    },
    {
        "title": "feat(tracker): Implement exponential backoff for Supabase Realtime reconnection in tracker.js",
        "body": "### Description\nThe `tracker.js` module creates Supabase Realtime channels for driver locations. If the connection drops, there is no explicit exponential backoff configured for channel reconnection, which could lead to thundering herd problems on the Supabase instance when network connectivity is restored.\n\n### Expected Behavior\n- Implement exponential backoff for Supabase Realtime channels.\n- Add jitter to prevent simultaneous reconnections."
    },
    {
        "title": "security(tracker): Validate X-Forwarded-For header to prevent IP spoofing in WebSocket upgrade rate limit",
        "body": "### Description\nIn `tracker.js`, the `getClientIp` function naively splits the `x-forwarded-for` header and takes the first IP address. If the application is behind a proxy, an attacker can easily spoof this header by sending a custom `X-Forwarded-For` header, bypassing the `WS_UPGRADE_RATE_LIMIT` entirely.\n\n### Expected Behavior\n- Configure Express `trust proxy` correctly.\n- Extract the reliable client IP using standard Express properties (`req.ip`) instead of manual header parsing."
    },
    {
        "title": "bug(reputation): Handle extremely delayed RPC responses in getDriverReputation to prevent memory leaks",
        "body": "### Description\nThe `getDriverReputation` function in `reputation.js` uses `Promise.race` with a 5000ms timeout. However, if the ethers RPC call hangs indefinitely, the underlying Promise is never rejected or resolved, and the TCP socket remains open, potentially causing a memory/socket leak over time under heavy load.\n\n### Expected Behavior\n- Cancel the underlying ethers request if the timeout is reached.\n- Alternatively, configure a hard timeout directly on the ethers provider."
    },
    {
        "title": "feat(db): Add health check endpoints for MongoDB and Redis readiness probes",
        "body": "### Description\nThe backend lacks a comprehensive `/api/health` endpoint that actually verifies the connection status of MongoDB, Redis, and Supabase. Kubernetes readiness probes need this to ensure traffic is only routed to pods with active database connections.\n\n### Expected Behavior\n- Create a new endpoint `GET /api/health`.\n- It should perform a quick ping to Mongo, Redis, and Supabase.\n- Returns 200 OK if all are healthy, 503 otherwise."
    },
    {
        "title": "test(e2e): Implement end-to-end load testing for WebSocket location ping ingestion",
        "body": "### Description\nThe `tracker.js` WebSocket logic handles high-frequency location pings. We need an automated load test (e.g., using Artillery or k6) to simulate 1000+ concurrent drivers sending 1 ping per second to ensure the double-buffer flush mechanism and memory usage remain stable.\n\n### Expected Behavior\n- Add a `load-test` script in `package.json`.\n- The test should verify that the MongoDB telemetry batch insertion keeps up with the ingress rate."
    },
    {
        "title": "refactor(routes): Move tripRoutes validation logic to dedicated middleware files",
        "body": "### Description\nThe `tripRoutes.js` file contains almost 400 lines of code, heavily populated with Zod schemas and validation functions (e.g., `validateEventPayload`, `verifyTripIdsBelongToUser`). Moving these to a dedicated `middleware/validation.js` or `validators/tripValidator.js` will improve readability and testability.\n\n### Expected Behavior\n- Zod schemas and validation middleware are extracted from `tripRoutes.js`.\n- `tripRoutes.js` focuses solely on request handling and business logic."
    },
    {
        "title": "feat(backend): Implement structured circuit breaker pattern for external ML and routing APIs",
        "body": "### Description\nThe backend relies on external services (OSRM for routing, ML service for pricing). If these services experience degradation, the backend will hang or fail slowly. Implementing a Circuit Breaker pattern (using a library like `opossum`) will fail fast and fallback gracefully, protecting our API from cascading failures.\n\n### Expected Behavior\n- OSRM and ML API calls are wrapped in a Circuit Breaker.\n- When the breaker is open, requests fail immediately or return cached/default estimates."
    },
    {
        "title": "feat(flutter): Implement secure storage for JWT tokens instead of plain SharedPreferences",
        "body": "### Description\nThe Flutter apps currently seem to store sensitive authentication tokens in plain text if using standard caching. Using `flutter_secure_storage` is necessary to encrypt tokens at rest (using Keychain on iOS and Keystore on Android) to prevent token extraction on compromised devices.\n\n### Expected Behavior\n- JWT tokens are stored using `flutter_secure_storage`.\n- Plain text storage is strictly avoided for sensitive credentials."
    },
    {
        "title": "docs(architecture): Document offline sync batch payload schema and sequence control flow",
        "body": "### Description\nThe offline sync and out-of-order sequence control in `tracker.js` and `tripRoutes.js` are complex but undocumented outside of code comments. Adding a dedicated Markdown document with Mermaid sequence diagrams will help new contributors understand how idempotency and telemetry recovery work.\n\n### Expected Behavior\n- Add `docs/architecture/offline-sync.md`.\n- Include diagrams for the double-buffer flush and client retry mechanism."
    }
]

for issue in issues:
    print(f"Creating issue: {issue['title']}")
    subprocess.run([
        'gh', 'issue', 'create',
        '--title', issue['title'],
        '--body', issue['body'],
        '--label', 'enhancement,good first issue'
    ])
    print("Done.\\n")
