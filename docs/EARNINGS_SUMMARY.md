# Driver Earnings Summary

`buildEarningsSummary()` aggregates a driver's completed trips into the
summary payload the driver app renders.

## Semantics

- `totalGross` — sum of `total_earnings` (nullable values coerced to 0).
- `totalDeductions` — sum of `fuel_deducted`.
- `netEarnings` — `totalGross - totalDeductions`.
- `tripCount` — number of trips in the window.
- `brokerSavingsPercent` — constant 35% (`BROKER_COMMISSION_RATE`).
- `brokerSavingsAmount` — `round(totalGross * 0.35)`.
- `trips` — per-trip `{ id, date, distance, gross, deductions, net }`.

## Periods

`getPeriodStart(period)` returns the inclusive lower bound:

- `weekly` — 7 days ago.
- `monthly` (default) — first of the current month.

## Guards

- Non-array `trips` input is treated as an empty list.
- Nullable numeric columns are coerced to 0 so a single null cannot turn the
  whole summary into NaN.
- `MAX_TRIPS_PER_SUMMARY` (500) caps how many rows a single summary reads.

The module is deliberately free of Express/Supabase imports so the
arithmetic is unit-testable in isolation.
