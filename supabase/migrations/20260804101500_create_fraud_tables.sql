-- Migration: Create fraud-detection tables
-- Backs FraudDetectionService persistence (behavioral_profiles,
-- fraud_risk_scores, fraud_review_queue).

CREATE TABLE IF NOT EXISTS behavioral_profiles (
  user_id       uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  events        jsonb NOT NULL DEFAULT '[]'::jsonb,
  patterns      jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_activity bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fraud_risk_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  risk_score  numeric NOT NULL DEFAULT 0,
  components  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fraud_risk_scores_user_idx
  ON fraud_risk_scores (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fraud_review_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  risk_score  numeric NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fraud_review_queue_status_idx
  ON fraud_review_queue (status);

-- Service uses the anon client on behalf of authenticated users.
ALTER TABLE behavioral_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY behavioral_profiles_authenticated_all
  ON behavioral_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY fraud_risk_scores_authenticated_all
  ON fraud_risk_scores FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY fraud_review_queue_authenticated_all
  ON fraud_review_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);
