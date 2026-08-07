import cron from 'node-cron';
import logger from '../middleware/logger.js';
import { supabase, supabaseAdmin } from '../config/db.js';
import { sendPushNotification } from '../services/notificationService.js';
import { submitEscrowRefund, confirmEscrowRefund } from '../services/escrow.js';
import { WorkerTracer } from '../core/telemetry/WorkerTracer.js';
import spanFactory from '../core/telemetry/SpanFactory.js';

let staleOrderWorkerTask = null;
let staleOrderClient = null;

const STALE_ORDER_CANCELLATION_REASON = 'Stale order: no accepted bid within 24 hours.';

export const startStaleOrderWorker = (orderRepository) => {
  if (staleOrderWorkerTask) {
    logger.info('[StaleOrderWorker] Stale order cleanup cron job already scheduled.');
    return staleOrderWorkerTask;
  }

  if (orderRepository) {
    staleOrderClient = orderRepository.supabase;
  } else if (supabaseAdmin) {
    staleOrderClient = supabaseAdmin;
  } else {
    staleOrderClient = supabase;
    logger.warn(
      '[StaleOrderWorker] Service-role client not configured - falling back to the anon-key client. RLS will block stale-order reads/writes.'
    );
  }

  const tracedHandler = WorkerTracer.wrapCronJob('stale-order-worker', async () => {
    logger.info('[StaleOrderWorker] Starting cleanup of stale pending orders...');
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Find all pending orders created more than 24 hours ago
      const { data: staleOrders, error: fetchError } = await staleOrderClient
        .from('orders')
        .select('id, customer_id, order_display_id')
        .eq('status', 'pending')
        .lt('created_at', twentyFourHoursAgo);

      if (fetchError) {
        logger.error(`[StaleOrderWorker] Error fetching stale orders: ${fetchError.message}`);
        return;
      }

      if (!staleOrders || staleOrders.length === 0) {
        logger.info('[StaleOrderWorker] No stale orders found.');
        return;
      }

      logger.info(`[StaleOrderWorker] Found ${staleOrders.length} stale pending orders. Cancelling...`);

      spanFactory.getActiveSpan()?.setAttributes({
        'stale_orders.count': staleOrders.length,
      });

      // Process stale orders with bounded concurrency (e.g. 5 concurrent operations) to avoid lock contention and speed up execution
      const CONCURRENCY_LIMIT = 5;
      let index = 0;
      async function workerPool() {
        while (index < staleOrders.length) {
          const currentIndex = index++;
          const order = staleOrders[currentIndex];
          if (order) {
            await cancelStaleOrder(order);
          }
        }
      }

      const poolSize = Math.min(CONCURRENCY_LIMIT, staleOrders.length);
      await Promise.all(Array.from({ length: poolSize }, () => workerPool()));

      logger.info('[StaleOrderWorker] Cleanup of stale pending orders completed.');
    } catch (err) {
      logger.error(`[StaleOrderWorker] Unexpected error during cleanup: ${err.message}`);
    }
  }, { schedule: '0 * * * *' });

  // Run every hour at minute 0
  staleOrderWorkerTask = cron.schedule('0 * * * *', tracedHandler);

  logger.info('[StaleOrderWorker] Stale order cleanup cron job scheduled (runs every hour).');
  return staleOrderWorkerTask;
};

/**
 * Cancel a single stale order without racing concurrent bid acceptance.
 *
 * TOCTOU fix (issue #5741): bidAcceptanceService.acceptBid persists the escrow
 * booking reference (escrow_status='funding') while the order is still
 * 'pending', and only later flips it to 'truck_assigned'. A naive
 * status-overwrite could therefore cancel an order that was just accepted and
 * strand on-chain escrow funds. We therefore:
 *   1. Re-fetch the order inside the loop with a status='pending' filter to
 *      close the window between the batch SELECT and the per-order UPDATE.
 *   2. Skip orders whose escrow_status is 'funding' — those belong to the
 *      escrow-funding reconciliation worker.
 *   3. Run every cancellation UPDATE guarded by status='pending' (and the
 *      current escrow_status), so it can never overwrite a concurrently
 *      accepted order.
 *   4. When escrow is funded, route the refund through the same escrow refund
 *      pipeline used by orderLifecycleService.cancelOrder before finalising
 *      the cancellation.
 *
 * @param {{id: string, customer_id: string, order_display_id: string}} staleOrder
 * @returns {Promise<void>}
 */
async function cancelStaleOrder(staleOrder) {
  try {
    // Re-fetch the order inside the loop with a status filter to close the
    // window between the batch SELECT and the per-order UPDATE.
    const { data: current, error: refetchErr } = await staleOrderClient
      .from('orders')
      .select('id, customer_id, order_display_id, escrow_status, refund_tx_hash, escrow_refund_attempts')
      .eq('id', staleOrder.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (refetchErr) {
      logger.error(`[StaleOrderWorker] Failed to re-fetch order ${staleOrder.id}: ${refetchErr.message}`);
      return;
    }

    if (!current) {
      logger.info(`[StaleOrderWorker] Order ${staleOrder.id} is no longer pending (accepted or cancelled concurrently), skipping.`);
      return;
    }

    const escrowStatus = current.escrow_status ?? 'pending';

    // An order that entered the two-phase acceptance flow (escrow_status
    // 'funding' is persisted BEFORE status moves to 'truck_assigned') must
    // never be cancelled here — the escrow-funding reconciliation worker owns
    // the funding → healed/reverted transition.
    if (escrowStatus === 'funding') {
      logger.info(`[StaleOrderWorker] Order ${current.order_display_id} has escrow funding in flight, skipping.`);
      return;
    }

    const requiresRefund = ['funded', 'refund_pending', 'refund_failed'].includes(escrowStatus);

    const cancelled = requiresRefund
      ? await cancelWithRefund(current, escrowStatus)
      : await cancelPlain(current);

    if (!cancelled) {
      logger.info(`[StaleOrderWorker] Order ${current.order_display_id} was not cancelled (state changed concurrently), skipping side effects.`);
      return;
    }

    // Cancel associated load offers (guarded on nothing — the order is now
    // cancelled, so its offers can never be fulfilled).
    await staleOrderClient
      .from('load_offers')
      .update({ status: 'cancelled' })
      .eq('order_display_id', current.order_display_id);

    // Send a notification to the customer
    try {
      await sendPushNotification(
        current.customer_id,
        'Order Cancelled',
        requiresRefund
          ? `Your order ${current.order_display_id} was cancelled because it was not completed in time. Any escrowed funds are being refunded.`
          : 'Your order was cancelled because it received no accepted bids within 24 hours. Please try posting again.',
        'ORDER_CANCELLED',
        { orderId: current.id, orderDisplayId: current.order_display_id }
      );
      logger.info(`[StaleOrderWorker] Cancelled order ${current.order_display_id} and notified customer ${current.customer_id}.`);
    } catch (notifyErr) {
      logger.warn(`[StaleOrderWorker] Cancelled order ${current.order_display_id}, but failed to notify customer ${current.customer_id}: ${notifyErr.message}`);
    }
  } catch (err) {
    logger.error(`[StaleOrderWorker] Error processing stale order ${staleOrder.id}: ${err.message}`);
  }
}

/**
 * Cancel an order that has no escrow involvement (escrow_status NULL or
 * 'pending'). The UPDATE is guarded on status='pending' AND escrow_status
 * NULL/'pending', so a concurrently accepted order is never overwritten.
 *
 * @returns {Promise<boolean>} true when the order was actually cancelled
 */
async function cancelPlain(current) {
  const { data: cancelled, error: updateErr } = await staleOrderClient
    .from('orders')
    .update({
      status: 'cancelled',
      cancellation_reason: STALE_ORDER_CANCELLATION_REASON,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id)
    .eq('status', 'pending')
    .or('escrow_status.is.null,escrow_status.eq.pending')
    .select('id');

  if (updateErr) {
    logger.error(`[StaleOrderWorker] Failed to cancel order ${current.id}: ${updateErr.message}`);
    return false;
  }

  return Boolean(cancelled && cancelled.length > 0);
}

/**
 * Cancel an order whose escrow is (or was) funded, routing the refund through
 * the same pipeline used by orderLifecycleService.cancelOrder: first place the
 * order into 'refund_pending' with a guarded update, then submit/confirm the
 * refund, then finalise to 'refunded'. Any failure lands the order in
 * 'refund_pending'/'refund_failed' so the escrow-refund reconciliation worker
 * retries it.
 *
 * @returns {Promise<boolean>} true when the order was actually cancelled
 */
async function cancelWithRefund(current, escrowStatus) {
  const attemptAt = new Date().toISOString();

  // Guarded transition: only an order that is STILL pending AND in the exact
  // escrow state we observed may enter refund reconciliation. This is the
  // serialisation point that prevents two workers from double-refunding.
  const { data: pendingOrder, error: pendingErr } = await staleOrderClient
    .from('orders')
    .update({
      status: 'cancelled',
      cancellation_reason: STALE_ORDER_CANCELLATION_REASON,
      escrow_status: 'refund_pending',
      escrow_refund_error: null,
      escrow_refund_attempts: (current.escrow_refund_attempts ?? 0) + 1,
      escrow_refund_last_attempt_at: attemptAt,
      updated_at: attemptAt,
    })
    .eq('id', current.id)
    .eq('status', 'pending')
    .eq('escrow_status', escrowStatus)
    .select('id');

  if (pendingErr) {
    logger.error(`[StaleOrderWorker] Failed to place order ${current.order_display_id} into refund reconciliation: ${pendingErr.message}`);
    return false;
  }

  if (!pendingOrder || pendingOrder.length === 0) {
    return false;
  }

  let refundTxHash = current.refund_tx_hash ?? null;
  try {
    if (refundTxHash) {
      await confirmEscrowRefund(refundTxHash);
    } else {
      const submitted = await submitEscrowRefund(current.order_display_id);
      if (submitted.waitForConfirmation) {
        const receipt = await submitted.waitForConfirmation();
        refundTxHash = receipt.hash ?? submitted.txHash;
      } else {
        // Escrow contract may not be initialised — record the tx hash and let
        // the escrow-refund reconciliation worker finalise confirmation.
        refundTxHash = submitted.txHash;
      }
    }

    const refundedAt = new Date().toISOString();
    const { error: finalErr } = await staleOrderClient
      .from('orders')
      .update({
        status: 'cancelled',
        escrow_status: 'refunded',
        refund_tx_hash: refundTxHash,
        escrow_refunded_at: refundedAt,
        escrow_refund_error: null,
        updated_at: refundedAt,
      })
      .eq('id', current.id)
      .in('escrow_status', ['refund_pending', 'refund_failed'])
      .select('id');

    if (finalErr) {
      logger.error(`[StaleOrderWorker] Refund confirmed for ${current.order_display_id} but final order update failed: ${finalErr.message}`);
    }

    return true;
  } catch (refundErr) {
    const failedAt = new Date().toISOString();
    const nextEscrowStatus = refundTxHash ? 'refund_pending' : 'refund_failed';
    await staleOrderClient
      .from('orders')
      .update({
        status: 'cancelled',
        escrow_status: nextEscrowStatus,
        refund_tx_hash: refundTxHash,
        escrow_refund_error: String(refundErr.message || refundErr).slice(0, 1000),
        escrow_refund_last_attempt_at: failedAt,
        updated_at: failedAt,
      })
      .eq('id', current.id)
      .in('escrow_status', ['refund_pending', 'refund_failed']);
    logger.error(`[StaleOrderWorker] Refund failed for order ${current.order_display_id}: ${refundErr.message}`);
    return true;
  }
}

export const stopStaleOrderWorker = () => {
  if (!staleOrderWorkerTask) return;

  staleOrderWorkerTask.stop();
  staleOrderWorkerTask = null;
  logger.info('[StaleOrderWorker] Stale order cleanup cron job stopped.');
};
