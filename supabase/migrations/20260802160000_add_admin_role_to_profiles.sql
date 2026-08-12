-- Allows the 'admin' role on profiles so admin-gated RLS policies can match.
--
-- The original profiles.role CHECK constraint only allowed ('customer', 'driver'),
-- which made the "Admins can read audit logs" policy (and the older admin RLS
-- policy docs) unsatisfiable — no row could ever carry role = 'admin', so the
-- admin audit-read feature was dead on arrival.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'driver', 'admin'));
