# Price Prediction Validator

## Overview

The Truxify backend validates every ML price prediction before it is used (`lib/predictionValidator.js`). The validator rejects NaN, Infinity, negative, out-of-range, or malformed predictions so bad model output can never become a quoted price.

---

## Location

```
backend/api/src/lib/predictionValidator.js
```

---

## Validation Rules

`validatePricePrediction(raw)` checks:

- The response is a non-null object.
- `estimated_price` is a finite number within the configured min/max bounds.
- `currency` is a supported code.
- `min_price`/`max_price` (when present) are finite and consistent with the estimate.
- Optional `confidence` is a valid number.

Failures return `{ ok: false, reason, detail }` with stable reason codes (e.g. `missing_field`, `negative`, `above_maximum`, `below_minimum`, `invalid_min_price`).

---

## Paisa Conversion

`convertToPaisa(priceInInr)` converts INR to integer paisa and rejects negative values.

---

## Why It Exists

ML models occasionally emit garbage — NaN serializes to `null`, and a model drift can produce absurd prices. Without validation, a bad prediction would reach the customer as a quoted fare. The validator (and its use in `services/ml.js`) makes the API fail over to deterministic pricing instead.

---

## Testing

Automated tests verify:

- Valid predictions pass.
- NaN, Infinity, negative, missing, and out-of-range values are rejected.
- Currency and min/max consistency checks.
- Paisa conversion bounds.
