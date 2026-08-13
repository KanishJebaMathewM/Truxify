# Freight Pricing

## Overview

The Truxify backend computes freight pricing server-side (`lib/pricing.js`) — the customer never supplies monetary values directly. Pricing inputs come from the route handler (distance, weight, goods type) and are run through a configurable rate card.

---

## Location

```
backend/api/src/lib/pricing.js
```

---

## Units

All monetary amounts are returned in **paisa** (1 INR = 100 paisa) to match the integer column types used elsewhere (e.g. `load_bids.bid_amount`).

---

## Pricing Model

`computeOrderPricing(input, rateCard)` computes:

- **baseFreight** — rate-per-tonne-km × weight × distance, with fragile/stackable multipliers, plus a handling fee.
- **tollEstimate** — toll-per-km × distance × toll factor.
- **platformFee** — a percentage of base freight.
- **totalAmount** — base + toll + platform fee.
- **fuelCost / netProfit** — driver-side cost/margin hints.

Distance defaults to the haversine great-circle distance when no road distance is supplied.

---

## Rate Card

Rate card values are read from environment variables at call time:

| Variable | Default |
|----------|---------|
| `TRUXIFY_RATE_PER_TONNE_KM` | 50 paisa |
| `TRUXIFY_FRAGILE_MULTIPLIER` | 1.5 |
| `TRUXIFY_STACKABLE_DISCOUNT` | 0.9 |
| `TRUXIFY_HANDLING_FEE` | 30000 paisa |
| `TRUXIFY_PLATFORM_FEE_PCT` | 5 |
| `TRUXIFY_FUEL_COST_PCT` | 45 |
| `TRUXIFY_TOLL_PER_KM` | 200 paisa |

---

## Guards

- `sanitizePrice` coerces invalid/negative values to 0.
- `haversineKm` throws on non-finite coordinates.
- `safePaisa` converts NaN/Infinity results to 0.
- Invalid inputs throw `TypeError`/`RangeError`.

---

## Why It Exists

Client-supplied prices are trivially forgeable (set `total_amount` to 1). Server-side pricing makes the money fields trustworthy and gives a single place to tune rates.

---

## Testing

Automated tests verify:

- Price computation for typical inputs.
- Fragile/stackable multipliers.
- Zero-distance and invalid-input guards.
- Rate-card parsing and defaults.
