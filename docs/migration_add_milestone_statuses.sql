-- Migration: Add 'en_route_pickup' and 'arrived_pickup' to orders table status constraint

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending',
  'truck_assigned',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'in_transit',
  'arriving',
  'delivered',
  'cancelled',
  'payment_released'
));
