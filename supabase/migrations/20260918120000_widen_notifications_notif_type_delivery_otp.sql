-- Fix #16145: widen notifications.notif_type CHECK to accept 'delivery_otp'
-- for delivery verification OTP push notifications and stored alerts.

-- Drop the existing CHECK constraint
alter table notifications
  drop constraint if exists notifications_notif_type_check;

-- Re-add with the full set of allowed values including delivery_otp
alter table notifications
  add constraint notifications_notif_type_check
  check (notif_type in (
    'order_update','payment','load_offer','trip_update','document','system',
    'bid_accepted','new_bid','payment_locked','payment_released','delivery_otp'
  ));
