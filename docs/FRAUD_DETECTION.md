# Fraud Detection Service

## Overview

The Truxify backend screens users and transactions for fraud (`services/fraud/FraudDetectionService.js`), combining rule checks, network analysis, and machine-learning signals.

---

## Location

```
backend/api/src/services/fraud/FraudDetectionService.js
```

---

## Signals

- **Cancellation / on-time behavior** — high cancellation rates and low on-time percentages raise risk.
- **Ratings and disputes** — low ratings and dispute history contribute.
- **Network analysis** — shared devices/IPs or suspicious link patterns between accounts.
- **ML signals** — the ML service's trust score (`scoreTrust`) can feed the assessment.
- **Account verification state** — unverified accounts score higher risk.

---

## Output

A risk profile with:

- A normalized `risk_score` (0-1).
- A `risk_category` (`low` / `medium` / `high` / `critical`).
- Per-signal contributions for explainability and review.

The fraud middleware consults this profile before high-value escrow/payment operations.

---

## Why It Exists

Fraud in freight platforms clusters around settlement: stolen accounts, synthetic drivers, and triangulation. Centralized detection lets every sensitive flow share the same risk model and review workflow.

---

## Testing

Automated tests verify:

- Risk scoring across signal combinations.
- Category thresholds.
- Network/connection analysis.
- Middleware threshold blocking.
