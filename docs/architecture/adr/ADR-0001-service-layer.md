# ADR-0001: Service Layer Decomposition for Order Workflow

## Status

Accepted

## Context

The original order routes in `orderRoutes.js` contained all business logic inline within Express route handlers. Each endpoint was a monolithic function that directly called Supabase, computed pricing, queried profiles, sent notifications, and managed error handling. This resulted in:

- **Route bloat**: A single file exceeding 1,500 lines with multiple conflicting code paths for the same operation.
- **Poor testability**: Business logic embedded in HTTP handlers could not be unit-tested without spinning up the full Express app.
- **Duplicated logic**: Pricing computation, profile enrichment, and ownership checks were repeated across endpoints.
- **No separation of concerns**: Validation, orchestration, data access, and external service calls were interleaved.
- **Difficult onboarding**: New contributors had to read the entire route file to understand one business operation.

## Decision

Decompose the order workflow into a layered service architecture with the following structure:

```text
Route Handler (thin)
  │
  ▼
OrderLifecycleService (orchestrator)
  │
  ├──► OrderValidationService (preconditions)
  ├──► OrderTimelineService (milestone management)
  ├──► BidAcceptanceService (bid + escrow logic)
  ├──► DeliveryVerificationService (OTP + escrow release)
  ├──► OrderNotificationService (FCM dispatch)
  │
  ▼
OrderRepository (data access)
```

### Principles

1. **Routes are thin**. Express handlers parse the request, extract parameters, delegate to the orchestrator, and return the response. No business logic lives in route handlers.
2. **Domain services own business rules**. Each service class is responsible for one domain concept: bid acceptance, delivery verification, milestone progression, etc.
3. **The orchestrator coordinates**. `OrderLifecycleService` is the single entry point for order operations. It calls the appropriate domain service, handles compensating actions on failure, and returns a result to the route.
4. **Validation is a service**. `OrderValidationService` extracts precondition checks (ownership, status, escrow state) into reusable assertions. Any operation can compose the assertions it needs.
5. **Errors are domain objects**. `DomainError` carries an HTTP status code and a structured payload, allowing services to communicate error semantics without depending on Express.

### Service Boundaries

| Service | Responsibility | Depends On |
| ------- | ------------- | --------- |
| `OrderLifecycleService` | Orchestrate multi-step operations; coordinate compensating transactions | All domain services + repository |
| `OrderCreationService` | Validate inputs, compute pricing, create order + timeline + load offer | Repository, OSRM, ML |
| `BidAcceptanceService` | Validate bid state, build escrow deposit, execute `accept_bid_tx` RPC | Repository, Escrow service |
| `DeliveryVerificationService` | Verify OTP, release escrow, execute `complete_trip_tx` RPC | Repository, Escrow, Notification |
| `OrderValidationService` | Reusable precondition assertions (ownership, status, escrow) | Supabase (direct) |
| `OrderTimelineService` | Manage milestone progression, sort-order validation, compensating rollbacks | Repository |
| `OrderNotificationService` | Generate OTP, dispatch FCM, track notification failures | Repository, Notification service |

## Consequences

### Positive

- Route handlers are now 3–10 lines each, down from hundreds.
- Services can be unit-tested with mocked repositories.
- Business rules are discoverable by filename — a contributor looking for bid acceptance logic knows to open `bidAcceptanceService.js`.
- Compensating transactions (rollback on failure) are explicit and localised.
- `DomainError` provides a consistent error contract between service and HTTP layer.

### Trade-offs

- Initial refactor cost was high — extracting logic from routes required careful analysis to avoid changing behaviour.
- Service classes add indirection; a simple operation now spans 3–4 files instead of 1.
- `OrderTimelineService` has two constructor signatures (repository vs. direct Supabase), creating an inconsistency described in ADR-0005.

### Future Considerations

- As the number of domain services grows, consider colocating them by bounded context (e.g., `src/services/order/`, `src/services/payment/`) rather than a flat `src/services/` directory.
- The orchestrator currently mixes coordination with some business logic; consider extracting a pure orchestration layer if complexity increases further.

## Alternatives Considered

### Keep logic in route handlers

Rejected because the route file had become unmaintainable at 1,500+ lines with duplicated and conflicting code paths. Testing required HTTP integration tests for every edge case.

### Use controllers as a separate layer

Some Express codebases introduce a controller layer between routes and services. We chose to keep routes as the controller because the routing concerns (parameter parsing, status code mapping) are already minimal and do not warrant an extra abstraction.

### Use a single monolithic service

A single `OrderService` class would have reproduced the same bloat as the route file, just in a different location. Decomposing by domain concept keeps each file focused and testable.
