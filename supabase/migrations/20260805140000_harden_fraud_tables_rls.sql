-- Migration: Harden RLS on fraud-detection tables (issue #6334)
-- Replaces the wide-open `FOR ALL TO authenticated USING (true)` policies from
-- 20260804101500_create_fraud_tables.sql with service-role-only writes and
-- admin-only reads, mirroring application_audit_logs
-- (20260723000010_create_application_audit_logs.sql). Fraud data (behavioral
-- profiles with location history, risk scores, review queue) must never be
-- readable, editable, or deletable by ordinary authenticated users.

DROP POLICY IF EXISTS behavioral_profiles_authenticated_all ON behavioral_profiles;
DROP POLICY IF EXISTS fraud_risk_scores_authenticated_all ON fraud_risk_scores;
DROP POLICY IF EXISTS fraud_review_queue_authenticated_all ON fraud_review_queue;

-- Admin users can read fraud data. The role check resolves through the
-- profiles table (server-authoritative, UPDATE-protected from authenticated),
-- never through client-editable user_metadata.
CREATE POLICY "Admins can read behavioral profiles"
  ON behavioral_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = get_profile_id()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can read fraud risk scores"
  ON fraud_risk_scores
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = get_profile_id()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can read fraud review queue"
  ON fraud_review_queue
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = get_profile_id()
      AND profiles.role = 'admin'
    )
  );

-- Only the backend service role can write fraud data (FraudDetectionService
-- persists through the service-role admin client).
CREATE POLICY "Service role can write behavioral profiles"
  ON behavioral_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can write fraud risk scores"
  ON fraud_risk_scores
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can write fraud review queue"
  ON fraud_review_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Ordinary authenticated users can never modify or delete fraud data.
CREATE POLICY "No updates on behavioral profiles"
  ON behavioral_profiles
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "No deletes on behavioral profiles"
  ON behavioral_profiles
  FOR DELETE
  TO authenticated
  USING (false);

CREATE POLICY "No updates on fraud risk scores"
  ON fraud_risk_scores
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "No deletes on fraud risk scores"
  ON fraud_risk_scores
  FOR DELETE
  TO authenticated
  USING (false);

CREATE POLICY "No updates on fraud review queue"
  ON fraud_review_queue
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "No deletes on fraud review queue"
  ON fraud_review_queue
  FOR DELETE
  TO authenticated
  USING (false);
