-- Drop overly permissive policies from fraud tables
DROP POLICY IF EXISTS behavioral_profiles_authenticated_all ON public.behavioral_profiles;
DROP POLICY IF EXISTS fraud_risk_scores_authenticated_all ON public.fraud_risk_scores;
DROP POLICY IF EXISTS fraud_review_queue_authenticated_all ON public.fraud_review_queue;

-- Admin read-only policies
CREATE POLICY "Admins can read behavioral_profiles"
ON public.behavioral_profiles FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

CREATE POLICY "Admins can read fraud_risk_scores"
ON public.fraud_risk_scores FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

CREATE POLICY "Admins can read fraud_review_queue"
ON public.fraud_review_queue FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

-- Note: Writes are performed by the backend service using the supabaseAdmin client (service_role),
-- which inherently bypasses RLS. Therefore, no INSERT/UPDATE/DELETE policies are needed for authenticated users.
