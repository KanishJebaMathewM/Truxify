-- supabase/migrations/20260814000000_fix_fraud_admin_rls.sql
-- Fix admin read policies for fraud tables per issue #10499

-- 1. behavioral_profiles policies
DROP POLICY IF EXISTS "Admins can read behavioral_profiles" ON public.behavioral_profiles;

CREATE POLICY "Admins can read behavioral_profiles"
  ON public.behavioral_profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.firebase_uid = (auth.jwt() ->> 'sub')
        AND profiles.role = 'admin'
    )
  );

-- 2. fraud_risk_scores policies
DROP POLICY IF EXISTS "Admins can read fraud_risk_scores" ON public.fraud_risk_scores;

CREATE POLICY "Admins can read fraud_risk_scores"
  ON public.fraud_risk_scores FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.firebase_uid = (auth.jwt() ->> 'sub')
        AND profiles.role = 'admin'
    )
  );

-- 3. fraud_review_queue policies
DROP POLICY IF EXISTS "Admins can read fraud_review_queue" ON public.fraud_review_queue;

CREATE POLICY "Admins can read fraud_review_queue"
  ON public.fraud_review_queue FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.firebase_uid = (auth.jwt() ->> 'sub')
        AND profiles.role = 'admin'
    )
  );
