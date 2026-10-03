alter table orders add column if not exists previous_eta timestamptz;
alter table orders add column if not exists delivery_delay_state text not null default 'normal'
  check (delivery_delay_state in ('normal', 'delayed'));

create index if not exists idx_orders_delivery_delay_state
  on orders (delivery_delay_state)
  where delivery_delay_state = 'delayed';
