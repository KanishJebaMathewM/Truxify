# ADR-0003: Order Lifecycle Orchestrator

## Status

Accepted

## Context

An order on Truxify progresses through multiple states over its lifetime — from creation through bidding, driver assignment, transit, delivery, payment release, and finally rating. Each state transition involves:

1. **Precondition checks** (does the user own this order? is it in the right status? is escrow configured?)
2. **Database mutations** (update order status, insert timeline entries, create transactions)
3. **External service calls** (OSRM route estimation, Polygon blockchain transactions, Firebase push notifications)
4. **Compensating actions** (roll back timeline on order update failure, refund escrow on RPC failure)
5. **Side effects** (award reputation points, send notifications, expire OTPs)

Without a central orchestrator, each route handler independently managed these steps, leading to:

- Inconsistent error handling — some operations rolled back, others left partial state.
- Duplicated sequence logic — the same "fetch order → check ownership → check status → update" pattern appeared in every handler.
- No single place to trace an order's full journey.

## Decision

Introduce `OrderLifecycleService` as the single orchestrator for all order state transitions.

### Request Flow

```text
HTTP Request
    │
    ▼
Express Route (parameter parsing, auth, validation)
    │
    ▼
OrderLifecycleService (orchestration, compensation)
    │
    ├──► OrderValidationService (precondition assertions)
    ├──► Domain Services (business logic)
    │       ├── BidAcceptanceService
    │       ├── DeliveryVerificationService
    │       └── OrderCreationService
    ├──► OrderTimelineService (milestone state)
    │
    ▼
OrderRepository (data access)
    │
    ▼
Supabase / Polygon / Firebase
```

### Orchestrator Responsibilities

| Method | Operations | Compensating Actions |
| ------ | --------- | ------------------- |
| `createOrder()` | Compute pricing (OSRM + ML), insert order, create timeline, create load offer | Delete order + timeline on load offer failure |
| `acceptBid()` | Delegates to `bidAcceptanceService.acceptBid()` | Escrow refund on RPC failure |
| `updateMilestone()` | Validate sequence, update timeline, update order status, generate OTP if "In Transit" | Roll back timeline milestone on order update failure |
| `verifyDeliveryFn()` | Delegates to `deliveryVerificationService.verifyDelivery()` | (handled inside service) |
| `cancelOrder()` | Fetch order, assert cancellable, update to cancelled, process blockchain refund, expire OTPs | Redis lock release on refund failure; partial-cancellation states for reconciliation |
| `changeDrop()` | Recompute pricing (OSRM), update order + load offer, insert timeline entry, expire OTPs | (none; failure is non-fatal for load offer update) |
| `submitRating()` | Assert deliverable, RPC `submit_rating_tx`, award on-chain reputation | Reputation failure logged to `reputation_failures` table |

### State Machine

```text
pending → truck_assigned → en_route_pickup → arrived_pickup → picked_up
    │                                                              │
    │                                                              ▼
    │                                                         in_transit
    │                                                              │
    │                                                              ▼
    │                                                         arriving
    │                                                              │
    │                                                              ▼
    │                                                     payment_released
    │                                                              │
    │                                                              ▼
    │                                                         (rating)
    │
    └──► cancelled (any point before payment_released)
              │
              └──► escrow_refunded (if escrow was funded)
```

### Compensating Transaction Pattern

When a multi-step operation fails mid-way, the orchestrator reverses prior steps:

```text
Step 1: INSERT order          ──► success
Step 2: INSERT timeline       ──► success
Step 3: INSERT load offer     ──► FAILURE
                                    │
                                    ▼
                              DELETE timeline (step 2 undo)
                              DELETE order (step 1 undo)
                                    │
                                    ▼
                              Return error response
```

This pattern appears in `createOrder()` and is applied selectively in other methods where partial success is acceptable.

## Consequences

### Positive

- Order state transitions are documented in one file. A contributor can trace the full lifecycle without reading route handlers.
- Compensating actions are explicit and localised, reducing the risk of partial updates.
- Adding a new state transition (e.g., "rebook") means adding a method to the orchestrator, not modifying every route.
- The orchestrator can be tested end-to-end with a mocked repository, covering happy path and failure scenarios.

### Trade-offs

- The orchestrator is large (789 lines) and growing. It currently mixes orchestration with some business logic (e.g., pricing computation in `createOrder()`, cancellation refund logic in `cancelOrder()`).
- Not all operations go through the orchestrator. `submitBid()` and `getBidsForOrder()` bypass it and are handled directly by `orderLifecycleService`, blurring the line between orchestration and passthrough.
- Compensating transactions are manual and not atomic. If the DELETE step also fails (e.g., network error), the system is left with orphaned data. The reconciliation services (`escrowRefundReconciliation`, `escrowReleaseReconciliation`) handle these edge cases asynchronously.

### Future Considerations

- Consider splitting the orchestrator into separate command handlers (e.g., `CreateOrderHandler`, `CancelOrderHandler`) if the class continues to grow. Each handler would implement a standard interface (`execute(command)`), making it easier to add middleware like logging, metrics, or idempotency at the handler level.
- The state machine is currently implicit in if/else chains. A formal state machine library (or even a lookup table of allowed transitions) would make the rules more readable and prevent invalid transitions at compile time.

## Alternatives Considered

### State logic in route handlers

Rejected because each route would duplicate precondition checks and error handling, leading to the original bloat problem.

### Event-driven orchestration

Using an event bus (e.g., RabbitMQ, Redis pub/sub) to trigger state transitions asynchronously was rejected because the order lifecycle requires synchronous responses to the client. A driver accepting a bid expects an immediate HTTP response, not a "submitted for processing" acknowledgement. Event-driven flow would be appropriate for side effects (notifications, reputation awards) but not for core state transitions.

### Database-level state machine (Supabase RPC)

Moving all state transition logic into PostgreSQL functions (RPCs) would provide atomicity but at the cost of expressiveness. External service calls (Polygon blockchain, Firebase FCM, OSRM routing) cannot be executed inside a database transaction. The current hybrid approach — RPCs for critical multi-table updates, application code for external calls — balances atomicity with flexibility.
