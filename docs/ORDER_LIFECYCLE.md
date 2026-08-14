# Order Lifecycle

## Overview

The Truxify backend models the full order lifecycle — creation, bidding, acceptance, milestones, delivery verification, and escrow settlement — through a set of order services (`services/order/`).

---

## Location

```
backend/api/src/services/order/orderCreationService.js       — order + load-offer creation
backend/api/src/services/order/orderValidationService.js     — state/ownership/escrow guards
backend/api/src/services/order/orderTimelineService.js       — milestone timeline events
backend/api/src/services/order/orderMilestoneService.js      — milestone transitions
backend/api/src/services/order/orderNotificationService.js   — lifecycle notifications
backend/api/src/services/order/bidAcceptanceService.js       — bid accept + escrow booking
backend/api/src/services/order/deliveryVerificationService.js — geofence/OTP verification
backend/api/src/services/order/orderLifecycleService.js      — orchestrates the above
backend/api/src/services/order/domainError.js                — typed domain errors
```

---

## Flow

1. **Create** — `orderCreationService` validates, computes server-side pricing, and inserts the order + load offer atomically.
2. **Bid** — drivers bid; `bidAcceptanceService` locks the order, books escrow, and accepts atomically (duplicate/conflict guarded by Redis locks).
3. **Milestones** — `orderMilestoneService` advances status (picked_up → in_transit → arriving) with timeline events and notifications; illegal transitions are rejected by `orderValidationService`.
4. **Delivery** — `deliveryVerificationService` runs the 2-of-3 oracle (OTP + GPS geofence + order status) before release.
5. **Settle** — escrow release/refund flows complete the lifecycle; reconciliation sweepers heal any stuck states.

---

## Why It Exists

Order state is the most safety-critical data in the platform — money moves on it. The service layer centralizes transition rules, ownership checks, escrow coupling, and notifications so the routes stay thin and the invariants stay enforced.

---

## Testing

Automated tests verify:

- Creation, bidding, and acceptance (including lock conflicts).
- Milestone transitions and validation rules.
- Delivery verification consensus.
- Timeline and notification behavior.
