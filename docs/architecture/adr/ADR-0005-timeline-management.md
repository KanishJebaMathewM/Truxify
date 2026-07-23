# ADR-0005: Timeline Management — Ordered Milestone Progression

## Status

Accepted

## Context

Every order on Truxify has a predefined set of milestones that track its physical progress:

```text
Order Placed (auto) → Truck Assigned → En Route to Pickup → Arrived at Pickup
→ Goods Loaded → In Transit → Arriving → Delivered
```

These milestones serve multiple purposes:

- **Customer visibility**: The customer app displays the current milestone and completed ones.
- **Driver guidance**: The driver app shows what to do next and prevents skipping steps.
- **Business logic triggers**: Certain milestones trigger side effects (e.g., "In Transit" generates a delivery OTP, "Delivered" releases escrow).
- **Audit trail**: Completed milestones with timestamps provide a non-repudiable record of the order's journey.

The initial implementation stored milestones as free-form strings, had no sort-order enforcement, and allowed milestones to be completed in any order by direct database manipulation.

## Decision

Introduce a structured milestone system managed by `OrderTimelineService`.

### Milestone Definition

```text
┌─────────────────┬─────────────┬──────────┐
│ Milestone       │ Sort Order  │ Auto?    │
├─────────────────┼─────────────┼──────────┤
│ Order Placed    │ 10          │ Yes      │
│ Truck Assigned  │ 20          │ Via RPC  │
│ En Route to...  │ 30          │ Driver   │
│ Arrived at...   │ 35          │ Driver   │
│ Goods Loaded    │ 40          │ Driver   │
│ In Transit      │ 50          │ Driver   │
│ Arriving        │ 55          │ Driver   │
│ Delivered       │ 60          │ Via RPC  │
│ Drop Changed    │ 25          │ Event    │
└─────────────────┴─────────────┴──────────┘
```

### Progression Rules

1. **Sequential ordering**: Milestones have a `sort_order` column. A milestone can only be completed if all milestones with a lower `sort_order` are already completed.
2. **No skipping**: The next incomplete milestone in sort order is the only one that can be completed next.
3. **Idempotent completion**: If a milestone is already marked completed, attempting to complete it again returns a 409 error.
4. **Automatic milestones**: Some milestones are set automatically by the system (Order Placed on creation, Truck Assigned via `accept_bid_tx` RPC, Delivered via `complete_trip_tx` RPC). Others are set by the driver through the milestone update endpoint.
5. **Event milestones**: Non-standard milestones like "Drop Changed" are inserted with an intermediate `sort_order` (25) between Order Placed (10) and Truck Assigned (20).

### Service Interface

```text
OrderTimelineService
  ├── generateDefaultTimeline(orderDisplayId)   // Create 8 milestones at order creation
  ├── getTimeline(orderDisplayId)                // Fetch with sort_order ordering
  ├── getTimelineWithSortCheck(orderDisplayId)   // Fetch for sequence validation
  ├── markMilestoneCompleted(orderDisplayId, milestone)  // Set completed=true + timestamp
  ├── rollbackMilestone(orderDisplayId, milestone)       // Revert to incomplete (compensation)
  ├── insertEntry(orderDisplayId, milestone, sortOrder)  // Insert event milestone
  └── deleteTimeline(orderDisplayId)                     // Remove all entries (compensation)
```

### Compensating Rollback

When a milestone update succeeds in the timeline but the corresponding order status update fails in the database, the system rolls back the milestone to incomplete:

```text
1. UPDATE order_timeline SET completed=true WHERE milestone='In Transit'
   ──► success
2. UPDATE orders SET status='in_transit' WHERE id=...
   ──► FAILURE (network error)
3. UPDATE order_timeline SET completed=false WHERE milestone='In Transit'
   ──► rollback success
4. Return 500 error
```

This ensures the timeline never shows a completed milestone when the order status was not actually updated.

## Consequences

### Positive

- Milestone progression is deterministic and enforceable. Drivers cannot skip steps or complete milestones out of order.
- The sort-order system makes it trivial to insert new milestones (e.g., "Drop Changed" at sort_order 25) without renumbering everything.
- The automatic milestones (Order Placed, Truck Assigned, Delivered) reduce driver error — critical transitions are handled by the system, not manual input.
- The timeline provides a clear audit trail for dispute resolution and customer support.

### Trade-offs

- `OrderTimelineService` has two constructor signatures: one accepts `{ supabase, logger }`, the other accepts a repository directly. This dual-path pattern exists for historical reasons — older code instantiates the service with Supabase directly, while newer code passes the repository. This inconsistency should be resolved by migrating all callers to the repository-based path.
- The compensating rollback is not atomic with the order update. There is a window where the timeline shows a milestone completed but the order status does not reflect it. In practice, this window is milliseconds and the rollback corrects it immediately.
- The "Order Placed" milestone is re-completed during cancellation (`markMilestoneCompleted(orderDisplayId, 'Order Placed')`), which is a no-op on the database but semantically confusing — the milestone is already completed.

### Future Considerations

- Consider replacing the dual constructor signature with a single repository-based interface. The `OrderTimelineService` would always receive an `orderRepository`, and callers that currently pass `{ supabase, logger }` would be updated to pass the repository.
- The milestone list could be made configurable per order type (e.g., express delivery vs. standard freight) by accepting a milestone template at order creation time.
- If audit requirements grow, consider storing a separate immutable milestone history table alongside the mutable timeline, capturing exactly who completed each milestone and when.

## Alternatives Considered

### Free-form status field

Rejected because a single status string cannot represent the rich progression of a physical shipment. The timeline provides granularity that a single status cannot (e.g., "arrived at pickup" vs. "goods loaded" are meaningfully different states).

### Single status with metadata

Some platforms use a single `status` column plus a `status_metadata` JSON field. Rejected because querying "which orders are currently 'In Transit'" would require filtering JSON fields, which is slow and error-prone compared to a dedicated milestone table.

### Client-driven milestones

Allowing the client to send arbitrary milestone strings was rejected because it would allow drivers to skip steps or fabricate progress. The milestone list is server-defined and enforced.

### Event-sourced timeline

An event-sourced approach (append-only log of order events) was considered but rejected for the initial implementation because it would require rebuilding the current state from events. The current mutable-timeline approach is simpler and sufficient for the current scale.
