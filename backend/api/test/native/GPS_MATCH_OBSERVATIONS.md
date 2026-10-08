# Native GPS Match observation checks

Run `NODE_ENV=production LOG_LEVEL=fatal node --test backend/api/test/native/hmmMapMatcher.node.mjs` with Node 24, Axios 1.20.0 and Pino 10.3.1 installed in the backend module environment. The focused workflow installs isolated dependencies rather than booting the API.

Tests exercise actual Axios, the repository CircuitBreaker, native AbortController and private loopback HTTP. No public OSRM provider, GPS receiver, database or vehicle is used. The exported matcher is a library; this change does not claim a mounted stream-ingestion caller.

Trajectory admission owns every finite geographic point before awaiting HTTP. At most 100 points, consistent optional nonnegative integer millisecond timestamps and finite nonnegative accuracy are admitted. Missing timestamps are omitted; epoch zero is retained. The existing 15–50 metre radius policy remains. A single observation cannot provide a trajectory match.

OSRM's [Match protocol](https://project-osrm.org/docs/v5.24.0/api/#match-service) uses per-tracepoint `matchings_index`, matching confidence in [0,1], and null outliers. Null/NoMatch/failure results preserve owned input coordinates with zero confidence, `matched: false` and explicit source/reason. No confidence is invented. Matched fields retain existing coordinate/confidence rounding and add provenance fields. Callers must use `matched` rather than interpreting retained input coordinates as road evidence.

Complete response admission occurs inside the breaker operation. Malformed, oversized, timed-out and failed HTTP responses count as request failures. The actual breaker constructor now receives its name and configured reset/request timeouts; its implementation is unchanged. Axios receives the breaker's abort signal. Request/response bounds apply here, not to other consumers or provider deployment limits. Process-local ownership does not establish distributed ordering, map accuracy, clinical safety or restart durability.
