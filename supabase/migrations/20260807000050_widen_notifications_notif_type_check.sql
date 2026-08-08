-- Fix #7538: widen notifications.notif_type CHECK to accept the values sent
-- by the bid/payment notification flows. sendPushNotification inserts
-- 'bid_accepted', 'new_bid', 'payment_locked' and 'payment_released', all of
-- which previously violated the CHECK and were silently dropped.

-- Drop the existing CHECK constraint (auto-named by Postgres from the inline
-- definition in supabase_setup.sql).
alter table notifications
  drop constraint if exists notifications_notif_type_check;

-- Re-add with the full set of allowed values.
alter table notifications
  add constraint notifications_notif_type_check
  check (notif_type in (
    'order_update','payment','load_offer','trip_update','document','system',
    'bid_accepted','new_bid','payment_locked','payment_released'
  ));
