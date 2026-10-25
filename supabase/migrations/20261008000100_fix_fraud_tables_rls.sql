-- ============================================================================
-- Migration: Secure Fraud Tables RLS Policies (Removes leftover PUBLIC access)
-- Issue: #9865 - behavioral_profiles, fraud_risk_scores, and fraud_review_queue
-- left with permissive PUBLIC FOR ALL policies from initial creation.
-- ============================================================================

BEGIN;

-- 1. Ensure Row Level Security is explicitly enabled on all fraud tables
ALTER TABLE behavioral_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_review_queue ENABLE ROW LEVEL SECURITY;

-- 2. Drop the leftover permissive PUBLIC service policies that were never cleaned up
DROP POLICY IF EXISTS behavioral_profiles_service_policy ON behavioral_profiles;
DROP POLICY IF EXISTS fraud_risk_scores_service_policy ON fraud_risk_scores;
DROP POLICY IF EXISTS fraud_review_queue_service_policy ON fraud_review_queue;

-- 3. Drop any redundant or conflicting authenticated/public policies to start clean
DROP POLICY IF EXISTS behavioral_profiles_authenticated_all ON behavioral_profiles;
DROP POLICY IF EXISTS fraud_risk_scores_authenticated_all ON fraud_risk_scores;
DROP POLICY IF EXISTS fraud_review_queue_authenticated_all ON fraud_review_queue;

-- 4. Re-apply strict and secure policies matching the intended hardening model:
--    - Service role (backend workers / FraudDetectionService) gets full access (TO service_role)
--    - Ordinary authenticated users are denied direct modifications / reads (or restricted to authorized admin scopes)

-- behavioral_profiles policies
CREATE POLICY "behavioral_profiles_service_role_all" ON behavioral_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "behavioral_profiles_authenticated_deny" ON behavioral_profiles
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- fraud_risk_scores policies
CREATE POLICY "fraud_risk_scores_service_role_all" ON fraud_risk_scores
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "fraud_risk_scores_authenticated_deny" ON fraud_risk_scores
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- fraud_review_queue policies
CREATE POLICY "fraud_review_queue_service_role_all" ON fraud_review_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "fraud_review_queue_authenticated_deny" ON fraud_review_queue
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
