# Event Bus

## Overview

The Truxify backend uses an internal event bus (`core/events/`) for decoupled, in-process communication between services — order lifecycle events, notifications, outbox relay, and more. An adapter layer supports local and distributed (Kafka/worker) transports.

---

## Location

```
backend/api/src/core/events/index.js        — bus instance + re-exports
backend/api/src/core/events/EventBus.js     — publish/subscribe core
backend/api/src/core/events/BaseEvent.js    — event envelope
backend/api/src/core/events/EventMetadata.js — event metadata (id, type, source, correlation)
backend/api/src/core/events/EventRegistry.js — type registration + validation
backend/api/src/core/events/EventPublisher.js / EventSubscriber.js
backend/api/src/core/events/adapters/       — Internal / Local / Kafka / Worker adapters
```

---

## Concepts

- **Events** extend `BaseEvent` with a `payload` and rich metadata (event ID, type, source, category, version, correlation/causation IDs).
- **Publish/Subscribe** — services publish typed events; subscribers register handlers per event type.
- **Registry** — event types can be registered with optional validators; publishing an unregistered type is flagged.
- **Tracing** — `EventTracer` wraps publish/subscribe/handler calls in OpenTelemetry spans, propagating correlation context.
- **Outbox integration** — the outbox relay worker publishes durable event records through the bus, so events survive restarts.

---

## Why It Exists

Direct service-to-service calls couple the order lifecycle, payments, notifications, and ML services. An event bus lets each service react to what happened without knowing who else cares, which keeps new integrations additive.

---

## Testing

Automated tests verify:

- Publish/subscribe dispatch and error handling.
- Event metadata and serialization.
- Registry validation.
- Adapter behavior (internal, worker, Kafka).
- Tracer wrapping.
