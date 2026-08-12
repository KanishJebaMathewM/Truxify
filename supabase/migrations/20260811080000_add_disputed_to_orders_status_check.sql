-- Fix #9915: allow orders.status to store 'disputed'. updateOrder(status: DISPUTED)
-- writes 'disputed', which previously violated the CHECK constraint and threw
-- Postgres error 23514 on every dispute-status update.

-- Drop the existing CHECK constraint (auto-named by Postgres from the inline
-- definition in supabase_setup.sql).
alter table orders
  drop constraint if exists orders_status_check;

-- Re-add with 'disputed' in the allowed set.
alter table orders
  add constraint orders_status_check
  check (status in (
    'pending','truck_assigned','en_route_pickup','arrived_pickup',
    'picked_up','in_transit','arriving','delivered','cancelled',
    'payment_released','disputed'
  ));
