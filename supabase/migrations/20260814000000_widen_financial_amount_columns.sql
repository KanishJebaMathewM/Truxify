-- Fix integer-overflow on financial amount columns (issue #13963).
-- High-value freight payments / payouts (and cross-border / MEV values) exceed
-- the 2,147,483,647 paisa (≈ ₹21.47L) ceiling of a 32-bit int, causing insert
-- failures or silent wraparound that corrupts balance accounting.

-- wallet_transactions.amount (paisa)
alter table if exists wallet_transactions
  alter column amount type numeric(20,0);

alter table if exists wallet_transactions
  drop constraint if exists wallet_transactions_amount_nonneg;

alter table if exists wallet_transactions
  add constraint wallet_transactions_amount_nonneg check (amount >= 0);

-- payments.amount_paisa (paisa)
alter table if exists payments
  alter column amount_paisa type numeric(20,0);

alter table if exists payments
  drop constraint if exists payments_amount_paisa_nonneg;

alter table if exists payments
  add constraint payments_amount_paisa_nonneg check (amount_paisa >= 0);
