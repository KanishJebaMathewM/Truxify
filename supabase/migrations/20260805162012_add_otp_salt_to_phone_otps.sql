-- Order-independent: the phone_otps table is created by
-- 20260810160000_create_phone_otps_table.sql. Guard the ALTER with IF EXISTS so
-- a fresh database where this migration runs before the table exists does not
-- fail ("relation phone_otps does not exist"). The create migration includes
-- the otp_salt column, so nothing is lost when this ALTER is a no-op.
ALTER TABLE IF EXISTS phone_otps ADD COLUMN IF NOT EXISTS otp_salt text;
