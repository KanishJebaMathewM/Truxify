# ADR-0004: Validation Workflow — Centralised Precondition Service

## Status

Accepted

## Context

Every state-changing order operation must verify preconditions before mutating data:

- Does the order exist?
- Does the requesting user own the order?
- Is the order in the correct status for this operation?
- Has the order already been delivered/cancelled/released?
- Is the escrow in the expected state?

In the initial codebase, these checks were duplicated across route handlers and services, often with different error messages or slightly different logic. For example, ownership was checked as `order.customer_id !== userId` in some places and `order.customer_id !== req.user.id` in others, and the error message varied.

This duplication made it difficult to:

- Ensure consistent error responses across all endpoints.
- Add a new precondition without auditing every existing operation.
- Reason about the complete set of preconditions for any given operation.

## Decision

Extract precondition assertions into a dedicated `OrderValidationService` class.

### Design

```javascript
class OrderValidationService {
  // Fetch + existence
  async findOrderByIdOrDisplayId(identifier, select)

  // Assertions (throw DomainError on failure)
  assertOrderFound(order)
  assertCustomerOwnership(order, userId)
  assertDriverAssignment(order, driverId)
  assertOrderAccess(order, userId)
  assertOrderStatus(order, allowedStatuses, errorMsg)
  assertNotTerminalStatus(order)
  assertEscrowState(order, allowedStates, errorMsg)
  assertMilestoneInTimeline(timeline, milestone)
  assertMilestoneNotDuplicate(entry)
  assertMilestoneSequence(timeline, milestone, lastCompletedSortOrder)
  assertChangeDropAllowed(order)
  assertHasWeight(order)

  // Combined assertions (fetch + check)
  async assertLoadOfferAvailable(loadOfferId)
  async assertTruckAssigned(driverId)
  async assertNoDuplicateBid(loadId, driverId)
  async assertDeliveryNotVerified(orderId)
  async assertNoDuplicateRating(orderDisplayId, customerId)
  assertRatingDeliverable(order)
}
```

### Usage Pattern

Services compose assertions declaratively at the start of each operation:

```javascript
// In cancelOrder():
const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, '*');
orderValidationService.assertOrderFound(order);
orderValidationService.assertCustomerOwnership(order, customerId);
await orderValidationService.assertDeliveryNotVerified(order.id);
orderValidationService.assertNotTerminalStatus(order);
```

### Assertion Contract

- Every assertion is a function that either returns `void` (precondition met) or throws `DomainError` (precondition failed).
- `DomainError` carries an HTTP status code and a structured JSON body, allowing the route handler to map it directly to an HTTP response without additional logic.
- Assertions never mutate state. They are pure checks that throw on violation.

### Error Code Consistency

| Condition | Status | Error Message Pattern |
| --------- | ------ | ------------------- |
| Resource not found | 404 | `'{resource} not found.'` |
| Not owner | 403 | `'Access Denied: You do not own this {resource}.'` |
| Not assigned driver | 403 | `'Access Denied: You are not assigned to this order.'` |
| Wrong status | 409 | `'Order status \'{status}\' does not allow this operation.'` |
| Duplicate operation | 409 | `'... has already been ...'` |
| Missing prerequisite | 422 | `'Milestone out of sequence. Expected ...'` |
| Server inconsistency | 500 | `'Data inconsistency: ...'` |

## Consequences

### Positive

- Precondition rules are defined once and reused across all operations. Adding `assertEscrowFunded()` means updating one file, not auditing every service.
- Error messages are consistent. A client that receives a 403 knows the exact wording is the same regardless of which endpoint triggered it.
- Services become more declarative. The first 5–10 lines of any operation method are readable precondition checks, clearly documenting what must be true before the operation proceeds.
- Assertions are unit-testable in isolation. `assertCustomerOwnership()` can be tested without a database connection.

### Trade-offs

- `OrderValidationService` has 20+ methods. It risks becoming a dumping ground for every conceivable check. We mitigate this by grouping related assertions under clear naming conventions (`assert*` for checks, `find*` for queries) and by keeping assertion methods focused on a single precondition.
- The service bypasses the repository for some queries (direct `this.supabase.from(...)` calls), violating the repository pattern described in ADR-0002. This is a known technical debt — validation queries should route through the repository for consistency.
- Throwing exceptions for control flow is idiomatic in JavaScript but can surprise contributors from languages where exceptions are reserved for exceptional situations. We accept this because `DomainError` is explicitly a control-flow mechanism in this architecture.

### Future Considerations

- If the assertion count grows beyond 30 methods, consider grouping by domain concept: `OrderAssertions`, `BidAssertions`, `EscrowAssertions`.
- Migrate all `this.supabase.from()` calls in the validation service to use the repository for consistency with ADR-0002.
- Consider introducing a fluent assertion API: `validate(order).isOwnedBy(userId).hasStatus('pending').elseThrow(409)`.

## Alternatives Considered

### Inline checks in each service

Rejected because it duplicated ownership and status checks across 5+ services with slightly varying error messages, making the API inconsistent.

### Validation middleware (Express-level)

Express middleware can validate request parameters and body shape (Zod schemas), but domain preconditions require database lookups (e.g., "does this bid belong to this order?"). Database-backed validation in middleware would require the middleware to call services, creating a circular dependency. Keeping domain validation in the service layer avoids this.

### Database RLS for access control

Supabase Row-Level Security (RLS) enforces basic row ownership at the database level. However, RLS cannot express domain rules like "order must be in 'arriving' status to verify delivery" or "milestone must be the next expected in sequence." RLS is used as a defence-in-depth layer, not as the primary validation mechanism.
