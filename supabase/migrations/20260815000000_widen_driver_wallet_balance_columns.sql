-- Fix integer-overflow on driver wallet balance accumulators (issue #14723).
-- The #13963 ledger widening (wallet_transactions.amount / payments.amount_paisa
-- -> numeric(20,0)) left the *balance* accumulators on driver_details as int4.
-- complete_trip_tx does `wallet_confirmed = wallet_confirmed + payout` (plain
-- int4 + int4). Once a driver's cumulative earnings cross 2,147,483,647 paisa
-- (~Rs21.47L) Postgres raises 22003 inside the transactional RPC and rolls back
-- the whole trip finalization, so the order is never paid. Widen the balances to
-- numeric(20,0) to match the ledger; the credit arithmetic is then numeric and
-- cannot overflow.

alter table if exists driver_details
  alter column wallet_confirmed type numeric(20,0);

alter table if exists driver_details
  alter column wallet_pending type numeric(20,0);

alter table if exists driver_details
  alter column wallet_total type numeric(20,0);
