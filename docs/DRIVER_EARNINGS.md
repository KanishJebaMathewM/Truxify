# Driver Earnings

## Overview

The Truxify backend aggregates driver earnings into summaries and reports (`services/driver/` + `services/driverEarningsService.js`) so the driver app can show gross earnings, net earnings, weekly charts, and cumulative stats.

---

## Location

```
backend/api/src/services/driverEarningsService.js      — aggregation logic
backend/api/src/services/driver/earningsSummaryService.js — period summaries + broker commission
backend/api/src/services/driver/earningsReportService.js  — report generation
```

---

## Aggregation

`calculateEarningsAggregation(trips, allCompletedTrips, lifetimeTrips)` computes:

- **gross_earnings** — sum of `total_earnings` (NaN-safe).
- **net_earnings** — sum of `net_earnings`.
- **trips_completed** — trip count.
- **weekly_chart** — last 7 days bucketed by day with earnings.
- **cumulative_stats** — total km, average earning per km, lifetime trips.
- **deadhead_trips_saved** — consecutive completed trips where the previous drop-off matches the next pickup within 3 days.

## Summaries

`buildEarningsSummary(trips, period, driverId)` groups trips by the requested period (daily/weekly/monthly), applies the broker commission rate (`BROKER_COMMISSION_RATE`, default 0.35) where applicable, and caps at `MAX_TRIPS_PER_SUMMARY`.

---

## Why It Exists

Drivers need trustworthy, computed earnings — not client-supplied numbers. Server-side aggregation keeps the driver dashboard accurate and consistent with the orders/ledger tables.

---

## Testing

Automated tests verify:

- NaN/Infinity-safe aggregation.
- Weekly chart bucketing.
- Period grouping and commission math.
- Empty-input handling.
