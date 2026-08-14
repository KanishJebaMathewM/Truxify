# Live Order Tracking (WebSocket Tracker)

## Overview

The Truxify backend streams driver location to customers in real time over WebSockets (`sockets/tracker.js`), with per-socket authentication, rate limiting, telemetry validation, and multi-replica fan-out.

---

## Location

```
backend/api/src/sockets/tracker.js
```

---

## Connection Flow

- Upgrade path: `/ws/tracking`, rate-limited per IP (`WS_UPGRADE_RATE_LIMIT`, default 5/min).
- A token in the URL query string is **refused** (close code 4001) — credentials must arrive via a first-frame `auth` event so they never leak into proxy logs.
- Unauthenticated sockets get a 10 s timeout to send `auth`.
- `BYPASS_AUTH` is available for local development only and is refused in production.

---

## Message Handling

| Event | Behavior |
|-------|----------|
| `auth` | Bearer-token authentication (Firebase or Supabase) |
| `location_ping` | Validates + sanitizes telemetry, persists, broadcasts |
| `subscribe_tracking` / `unsubscribe_tracking` | Manage order/driver subscriptions |

## Telemetry Safety

- Coordinate validation (lat `[-90,90]`, lng `[-180,180]`) and schema sanitization.
- Cross-field checks require a complete coordinate pair.
- Driver-ID spoofing is detected and the socket is closed (code 4010).
- Clock-skew tolerance drops implausible timestamps.
- Per-socket message rate limiting (10 msg/s) with a Redis-backed cluster-wide counter and in-memory fallback.
- Sequence idempotency: out-of-order pings are dropped, with a circuit breaker that resets after `MAX_CONSECUTIVE_DROPS`.

## Fan-out

- Local subscribers receive payloads exactly once, even when subscribed to both order and driver.
- A Redis Pub/Sub bus relays events across replicas; self-originated events are skipped.
- Supabase Realtime channels are cached per order and cleaned up on disconnect.
- GPS logs persist to MongoDB (ring-buffered with overflow protection) and driver locations upsert to Supabase.

---

## Why It Exists

Live tracking is the core driver-customer experience. The auth, validation, and rate-limiting layers keep the socket secure and cheap to operate at scale.

---

## Testing

Automated tests verify:

- Auth (first-frame, URL-token refusal, bypass).
- Telemetry validation and spoofing rejection.
- Subscription and fan-out delivery (including multi-replica cases).
- Rate limiting and buffer behavior.
