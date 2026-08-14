# KEDA Metrics Service

## Overview

The Truxify backend exposes Kubernetes autoscaling metrics through KEDA-scaler-style endpoints (`services/kedaService.js` + `routes/kedaRoutes.js`), so deployments can scale on API request volume, latency, CPU, memory, and Kafka lag.

---

## Location

```
backend/api/src/services/kedaService.js
backend/api/src/routes/kedaRoutes.js
```

---

## Endpoints

| Endpoint | Metric |
|----------|--------|
| `GET /api/keda/metrics/requests` | API request rate |
| `GET /api/keda/metrics/latency` | API latency |
| `GET /api/keda/metrics/cpu?namespace=&deployment=` | CPU usage |
| `GET /api/keda/metrics/memory?namespace=&deployment=` | Memory usage |
| `GET /api/keda/metrics/kafka-lag?topic=&consumerGroup=` | Kafka consumer lag |
| `GET /api/keda/metrics/autoscale?namespace=&deployment=` | Autoscale recommendation signals |
| `GET /api/keda/scale/recommend?namespace=&deployment=` | Recommended replica count |
| `GET /api/keda/stats` | Aggregate stats |

---

## Behavior

- Missing required query params (`namespace`/`deployment` or `topic`/`consumerGroup`) return `400`.
- Service failures return `502` (metric unavailable).
- Unexpected errors return `500`.

---

## Why It Exists

Autoscaling on business metrics (request rate, Kafka lag) reacts to real demand faster than CPU-only autoscaling, and keeps replicas proportional to queued work.

---

## Testing

Automated tests verify:

- Each endpoint's success path.
- Missing-parameter 400s.
- Service failure 502s and error 500s.
