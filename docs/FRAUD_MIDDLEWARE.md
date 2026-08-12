# Fraud Middleware

## Overview

The Truxify backend includes fraud-detection middleware that screens high-value operations (notably escrow transactions) before they proceed, using a risk-score threshold.

---

## Location

Middleware:

```
backend/api/src/middleware/fraudMiddleware.js
```

Detection engine:

```
backend/api/src/services/fraud/FraudDetectionService.js
```

---

## Behavior

- Intercepts operations flagged as fraud-sensitive (e.g. escrow deposits or payments above a value threshold).
- Computes a risk score from the request context (amount, user history, device signals, network relationships).
- When the risk score exceeds the configured threshold, the operation is refused with a `402 Payment Required`-style or `403` response.
- Below-threshold operations proceed with the risk score attached to the request for auditing.

---

## Configuration

Thresholds and scoring weights are read from configuration (environment variables) and can be tuned per deployment without code changes.

---

## Why It Exists

Fraud losses in logistics typically happen at settlement time. Screening high-value escrow and payment operations in the request path catches the majority of abuse (stolen accounts, synthetic drivers, triangulation) before funds move, while keeping legitimate traffic unaffected.

---

## Testing

Automated tests verify:

- Below-threshold operations are allowed.
- Above-threshold operations are blocked.
- Missing risk signals default safely.
- The risk score is attached to allowed requests.
