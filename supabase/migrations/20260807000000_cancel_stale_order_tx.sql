-- =============================================================================
-- Migration: Atomic compare-and-set cancellation for stale pending orders
-- (Issue: stale-order worker vs. bid acceptance race across API replicas)
-- =============================================================================
-- Problem:
--   The stale-order worker and bid acceptance both mutate `orders` with
--   read-then-write logic. When multiple API replicas run the hourly stale
--   sweep at the same time, a naive `UPDATE ... WHERE id = ...` can cancel an
--   order that a concurrent bid acceptance just transitioned to
--   'truck_assigned' (or whose two-phase escrow funding is in flight), and a
--   single lost comparison can produce two cancellations / duplicate refund
--   submissions.
--
-- Fix:
--   `cancel_stale_order_tx` performs the entire cancellation in ONE atomic SQL
--   statement guarded by a `FOR UPDATE` row lock plus the exact predicates the
--   bid-acceptance path relies on (status = 'pending', not yet accepted, older
--   than the worker's cutoff, and not inside the two-phase escrow-funding
--   window). A concurrent bid acceptance either wins the row lock first (the
--   order is no longer 'pending' / is 'funding', so this function no-ops) or
--   loses it after this function (the acceptance's own status/version checks
--   fail). Exactly one valid winner is guaranteed.
--
--   Escrow routing follows the existing recovery mechanisms instead of
--   silently cancelling financial state:
--     * escrow_status 'funding'            -> no-op (escrow-funding
--                                             reconciliation owns the
--                                             funding -> healed/reverted
--                                             transition)
--     * escrow_status 'funded'             -> status='cancelled' +
--                                             escrow_status='refund_pending'
--                                             (escrow-refund reconciliation
--                                             completes the on-chain refund;
--                                             it is the single refund
--                                             submitter, so no double-refund)
--     * escrow_status 'refund_pending' /
--       'refund_failed'                    -> ensure status='cancelled'; the
--                                             refund reconciliation worker
--                                             continues the retry loop
--     * escrow_status NULL or 'pending'    -> plain cancellation, no escrow
--
--   The function returns the cancelled row (or no rows for a lost race), so
--   the worker can run side effects (load-offer cancellation, customer
--   notification) ONLY after a successful claim.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_stale_order_tx(
  p_order_id            UUID,
  p_cancellation_reason TEXT,
  p_stale_since         TIMESTAMPTZ
)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  -- SECURITY DEFINER bypasses RLS, so only the backend (service_role) may run
  -- this. The owning-customer path is covered by cancel_order_tx instead.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the backend service can cancel stale orders';
  END IF;

  -- Serialise with bid acceptance (accept_bid_tx), confirm-deposit and
  -- cancel_order_tx, all of which lock the order row FOR UPDATE.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN;
  END IF;

  -- Stale guard (mirrors the worker's batch SELECT): the order must still be
  -- pending and older than the worker's cutoff. If a bid acceptance won the
  -- row lock first, status is no longer 'pending' and this no-ops.
  IF v_order.status <> 'pending' OR v_order.created_at >= p_stale_since THEN
    RETURN;
  END IF;

  -- Two-phase acceptance in flight: the escrow-funding reconciliation worker
  -- owns the funding -> healed/reverted transition. Never cancel here.
  IF v_order.escrow_status = 'funding' THEN
    RETURN;
  END IF;

  -- Escrow involvement: place the order into refund reconciliation (status
  -- 'cancelled' + escrow_status 'refund_pending'). The escrow-refund
  -- reconciliation worker is the single submitter of the on-chain refund, so
  -- a racing replica can never trigger a second refund.
  IF v_order.escrow_status IN ('funded', 'refund_pending', 'refund_failed') THEN
    RETURN QUERY
      UPDATE orders
         SET status                   = 'cancelled',
             cancellation_reason      = COALESCE(p_cancellation_reason, v_order.cancellation_reason),
             escrow_status            = 'refund_pending',
             escrow_refund_error      = NULL,
             escrow_refund_attempts   = COALESCE(v_order.escrow_refund_attempts, 0) + 1,
             escrow_refund_last_attempt_at = NOW(),
             updated_at               = NOW()
       WHERE id = p_order_id
         AND status = 'pending'
      RETURNING *;
    RETURN;
  END IF;

  -- Plain cancellation: no escrow involvement.
  RETURN QUERY
    UPDATE orders
       SET status              = 'cancelled',
           cancellation_reason = COALESCE(p_cancellation_reason, v_order.cancellation_reason),
           updated_at          = NOW()
     WHERE id = p_order_id
       AND status = 'pending'
    RETURNING *;
END;
$$;

-- SECURITY DEFINER functions bypass RLS; default PUBLIC EXECUTE must be
-- revoked so only the backend (service_role) can cancel stale orders.
REVOKE EXECUTE ON FUNCTION public.cancel_stale_order_tx(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_stale_order_tx(UUID, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
