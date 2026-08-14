# ML Service Integration

## Overview

The Truxify backend calls a Python ML microservice for demand/price/ETA predictions, load matching, packing optimization, and recommendations. The client (`services/ml.js`) handles routing, authentication, caching, validation, and fallbacks.

---

## Location

```
backend/api/src/services/ml.js
```

ML microservice:

```
backend/ml/
```

---

## Endpoints

| Function | ML endpoint |
|----------|-------------|
| `predictDemand` | `POST /predict/demand` |
| `predictPrice` | `POST /predict/price` |
| `predictEta` | `POST /predict/eta` |
| `matchBilateral` | `POST /match/bilateral` |
| `predictDriverProfit` | `POST /predict/driver-profit` |
| `optimisePacking` | `POST /optimise/packing` |
| `recommendLoads` / `recommendTrucks` | `POST /recommend/loads` / `/recommend/trucks` |
| `scoreTrust` | `POST /score/trust` |
| `matchDeadhead` / `matchEnRouteLoads` | `POST /match/deadhead` + haversine fallback |
| `optimiseMidTrip`, `trainDemandModel`, `trainPriceModel`, `listModels` | various |

---

## Configuration

| Variable | Description |
|----------|-------------|
| `ML_API_KEY` | Required; all ML endpoints return 503 without it |
| `ML_ENGINE_URL` / `ML_SERVICE_URL` | Base URL (default `http://localhost:8001`) |

---

## Safety

- Every price prediction passes through `validatePricePrediction`; invalid output throws so callers fall back to deterministic pricing.
- ETA and profit predictions are checked for finite values.
- `matchEnRouteLoads` falls back to a pure haversine ranking when the ML engine is unavailable, so the load market never returns empty when offers exist.
- Responses are cached (LRU, 15-minute TTL) to reduce engine load.

---

## Why It Exists

Separating ML inference into a microservice keeps the API decoupled from model serving, allows independent scaling, and lets the API degrade gracefully when the engine is down.

---

## Testing

Automated tests verify:

- Payload shapes for every endpoint.
- Auth failure, timeout, and invalid-JSON handling.
- Prediction validation (NaN, negative, out-of-range).
- Haversine fallback behavior.
