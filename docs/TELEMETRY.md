# Telemetry & Tracing

## Overview

The Truxify backend instruments workers, queues, events, and HTTP requests with OpenTelemetry spans (`core/telemetry/`). A single span factory produces consistent, attribute-rich spans, and context propagators carry trace context across Kafka messages, HTTP headers, and event payloads.

---

## Location

```
backend/api/src/core/telemetry/SpanFactory.js   — span creation helpers
backend/api/src/core/telemetry/EventTracer.js   — event bus tracing wrappers
backend/api/src/core/telemetry/QueueTracer.js   — Kafka produce/consume tracing
backend/api/src/core/telemetry/WorkerTracer.js  — worker/cron/interval tracing
backend/api/src/core/telemetry/ContextPropagator.js — trace context injection/extraction
backend/api/src/core/telemetry/TraceContext.js  — header serialize/deserialize
backend/api/src/tracing/tracing.js              — provider + instrumentation init
```

---

## Span Types

| Helper | Span name | Attributes |
|--------|-----------|------------|
| `startWorkerSpan` | `worker.execution` | worker name, attempt, max attempts |
| `startRetrySpan` | `retry.attempt` | operation, attempt, max, delay |
| `startQueueProduceSpan` | `queue.produce` | topic, operation |
| `startQueueConsumeSpan` | `queue.consume` | topic, partition, offset, consumer group |
| `startEventPublishSpan` | `event.publish` | event type, source, id |
| `startEventHandlerSpan` | `event.handler` | event type, handler name |
| `startSchedulerTaskSpan` | `scheduler.task` | task name, priority, id |

The factory also provides `withSpan` / `withWorkerSpan` / `withQueueConsumeSpan` helpers that manage the full span lifecycle around an async function, including error recording.

---

## Context Propagation

- **Kafka**: headers are injected into produced messages and extracted on consume, so a consumer's spans link to the producer's trace.
- **HTTP**: trace headers are injected/extracted for outgoing calls.
- **Events**: `traceContext` is embedded in event metadata and restored by subscribers/handlers.

---

## Why It Exists

Without a shared tracing vocabulary, each service would create ad-hoc spans with inconsistent names, making trace waterfalls unreadable. The factory standardizes span names and attributes, and the propagators keep traces connected across process and transport boundaries.

---

## Testing

Automated tests verify:

- Span creation and attribute population.
- Error recording and span lifecycle.
- Wrapper behavior for workers, queues, and events.
- Context propagation round-trips.
