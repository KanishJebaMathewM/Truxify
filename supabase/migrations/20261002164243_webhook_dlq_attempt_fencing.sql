-- Exact-attempt webhook DLQ admission and settlement. Apply before the API.
-- Existing claim RPC/schema/policies and business processors are unchanged.
-- Lock first, then consult clock_timestamp(): a lock wait cannot preserve an
-- expired lease using a transaction-start timestamp.
CREATE OR REPLACE FUNCTION public.admit_webhook_failure_attempt(
  p_event_id uuid, p_worker_id text, p_attempt_count integer, p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_row public.webhook_failures%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_attempt_count IS NULL OR p_attempt_count < 1
     OR p_worker_id IS NULL OR p_worker_id = ''
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RETURN false;
  END IF;
  SELECT * INTO v_row FROM public.webhook_failures
    WHERE id = p_event_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_row.status <> 'processing'
     OR v_row.claimed_by IS DISTINCT FROM p_worker_id
     OR v_row.attempt_count IS DISTINCT FROM p_attempt_count
     OR v_row.lease_expires_at IS NULL OR v_row.lease_expires_at <= v_now THEN
    RETURN false;
  END IF;
  UPDATE public.webhook_failures SET
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    updated_at = v_now WHERE id = p_event_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_webhook_failure_attempt(
  p_event_id uuid, p_worker_id text, p_attempt_count integer,
  p_status text, p_retry_count integer DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT NULL, p_error_message text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_row public.webhook_failures%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('resolved', 'pending', 'failed_permanently')
     OR p_attempt_count IS NULL OR p_attempt_count < 1
     OR p_worker_id IS NULL OR p_worker_id = ''
     OR (p_status <> 'resolved' AND (p_retry_count IS NULL OR p_retry_count < 0))
     OR (p_status = 'pending' AND p_next_retry_at IS NULL) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_row FROM public.webhook_failures
    WHERE id = p_event_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_row.status <> 'processing'
     OR v_row.claimed_by IS DISTINCT FROM p_worker_id
     OR v_row.attempt_count IS DISTINCT FROM p_attempt_count
     OR v_row.lease_expires_at IS NULL OR v_row.lease_expires_at <= v_now THEN
    RETURN false;
  END IF;
  UPDATE public.webhook_failures SET
    status = p_status,
    retry_count = CASE WHEN p_status = 'resolved' THEN retry_count ELSE p_retry_count END,
    next_retry_at = CASE WHEN p_status = 'pending' THEN p_next_retry_at ELSE NULL END,
    error_message = CASE WHEN p_status = 'resolved' THEN NULL ELSE left(p_error_message, 1000) END,
    resolved_at = CASE WHEN p_status = 'resolved' THEN v_now ELSE resolved_at END,
    updated_at = v_now, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
  WHERE id = p_event_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admit_webhook_failure_attempt(uuid,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_webhook_failure_attempt(uuid,text,integer,text,integer,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_webhook_failure_attempt(uuid,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_webhook_failure_attempt(uuid,text,integer,text,integer,timestamptz,text) TO service_role;
