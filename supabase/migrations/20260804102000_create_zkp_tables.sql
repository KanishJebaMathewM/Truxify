-- Migration: Add KYC columns to profiles + create zk_proofs and kyc_audit_logs
-- The ZKP service queried a non-existent users table and two tables that were
-- never created. This points auth at the real profiles table and creates the
-- missing tables.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_verified boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_verified_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_tx_hash text;

CREATE TABLE IF NOT EXISTS zk_proofs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proof          jsonb NOT NULL,
  public_signals jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zk_proofs_user_idx ON zk_proofs (user_id);

CREATE TABLE IF NOT EXISTS kyc_audit_logs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action    text NOT NULL,
  status    text NOT NULL,
  tx_hash   text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyc_audit_logs_user_idx ON kyc_audit_logs (user_id);
