-- Fix #7529: add missing notification_failed column to orders.
-- orderNotificationService, orderMilestoneService and deliveryVerificationService
-- write notification_failed on orders, which previously failed with PGRST204.
alter table orders
  add column if not exists notification_failed boolean not null default false;
