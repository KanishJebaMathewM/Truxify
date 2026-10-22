-- #17056: apply provider outcomes only to the registration that was sent.
BEGIN;
CREATE OR REPLACE FUNCTION public.apply_fcm_lifecycle_outcomes(p_user_id uuid, p_outcomes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_deactivated integer := 0;
  v_touched integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_outcomes IS NULL OR pg_catalog.jsonb_typeof(p_outcomes) <> 'array' THEN
    RAISE EXCEPTION 'Invalid FCM lifecycle batch' USING ERRCODE = '22023';
  END IF;
  -- Record conversion validates UUIDs before any mutation. Only trusted backend
  -- outcomes are accepted; this invoker function does not bypass table RLS.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_outcomes) AS x(id uuid, token text, outcome text)
    WHERE x.token IS NULL OR x.token = '' OR x.outcome IS NULL
      OR x.outcome NOT IN ('success','invalid') OR (x.outcome = 'success' AND x.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Invalid FCM lifecycle outcome' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_devices AS d
  SET is_active = false, deactivated_at = v_now
  WHERE d.user_id = p_user_id AND d.is_active = true AND EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_outcomes) AS x(id uuid, token text, outcome text)
    WHERE x.outcome = 'invalid' AND x.id = d.id AND x.token = d.fcm_token
  );
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  UPDATE public.user_devices AS d
  SET last_seen = GREATEST(d.last_seen, v_now)
  WHERE d.user_id = p_user_id AND d.is_active = true AND EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_outcomes) AS x(id uuid, token text, outcome text)
    WHERE x.outcome = 'success' AND x.id = d.id AND x.token = d.fcm_token
  );
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  UPDATE public.profiles AS p
  SET fcm_token = NULL, fcm_token_updated_at = v_now
  WHERE p.id = p_user_id AND EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_outcomes) AS x(id uuid, token text, outcome text)
    WHERE x.outcome = 'invalid' AND x.token = p.fcm_token
  );
  RETURN pg_catalog.jsonb_build_object('deactivated',v_deactivated,'touched',v_touched);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_fcm_lifecycle_outcomes(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_fcm_lifecycle_outcomes(uuid,jsonb) TO service_role;
COMMENT ON FUNCTION public.apply_fcm_lifecycle_outcomes(uuid,jsonb) IS 'Conditionally apply captured FCM token outcomes; invoker/RLS preserved, no legacy ID-only fallback.';
COMMIT;
