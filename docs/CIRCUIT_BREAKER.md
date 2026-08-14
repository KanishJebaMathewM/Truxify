# Circuit Breaker

## Overview

The Truxify backend wraps OSRM and other external calls in a circuit breaker (`lib/circuitBreaker.js`). When a dependency fails repeatedly, the breaker opens and fails fast instead of hammering a dead service.

---

## Location

```
backend/api/src/lib/circuitBreaker.js
```

---

## States

| State | Behavior |
|-------|----------|
| **Closed** | Requests pass through to the dependency; failures are counted. |
| **Open** | Requests fail fast (fallback) without calling the dependency; a half-open timer schedules a probe. |
| **Half-open** | A single probe request is allowed; success closes the breaker, failure reopens it. |

---

## Behavior

- Opens after a configurable failure threshold within the window.
- The scheduled half-open transition timer is `unref()`ed so it never holds the process open during shutdown or test teardown.
- Supports an optional fallback function invoked while the breaker is open.
- Exposes `destroy()` for resource cleanup (clears timers and listeners).

---

## Why It Exists

External dependencies (routing engines, geocoders, ML services) fail in clusters. Without a breaker, every request during an outage blocks on timeouts, exhausting connection pools and making the whole API slow. The breaker isolates the failure and gives the dependency time to recover.

---

## Testing

Automated tests verify:

- Closed-to-open transitions after repeated failures.
- Fast-fail behavior while open.
- Half-open probe success/failure.
- Timer cleanup on destroy.
