import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import logger from '../middleware/logger.js';
import { supabase, supabaseAdmin, redisClient } from '../config/db.js';
import { sendPushNotification } from '../services/notificationService.js';
import { confirmEscrowRefund, submitEscrowRefund } from '../services/escrow.js';
import { WorkerTracer } from '../core/telemetry/WorkerTracer.js';
import spanFactory from '../core/telemetry/SpanFactory.js';
import { OrderRepository } from '../repositories/orderRepository.js';

let staleOrderWorkerTask = null;
let staleOrderRunning = false;

const STALE_ORDER_CANCELLATION_REASON = 'Stale order: no accepted bid within 24 hours.';

// Owner-aware batch admission lease. Loss stops new work; already-started
// operations may overlap a successor and remain protected by the database CAS.
const LOCK_KEY = 'stale:order:cancellation:lock';
const LOCK_TTL_SECONDS = 120;
const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const MAX_BATCH_SIZE = 1000;

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_STALE_ORDER_AGE_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY_LIMIT = 5;

export const startStaleOrderWorker = (orderRepository) => {
  if (staleOrderWorkerTask) {
    logger.info('[StaleOrderWorker] Stale order cleanup cron job already scheduled.');
    return staleOrderWorkerTask;
  }

  const repository = orderRepository || new OrderRepository(supabaseAdmin || supabase);
  if (!orderRepository && !supabaseAdmin) {
    logger.warn(
      '[StaleOrderWorker] Service-role client not configured - falling back to the anon-key client. RLS will block stale-order reads/writes.'
    );
  }

  const tracedHandler = WorkerTracer.wrapCronJob('stale-order-worker', async () => {
    await reconcileStaleOrders(repository);
  }, { schedule: '0 * * * *' });

  // Run every hour at minute 0
  staleOrderWorkerTask = cron.schedule('0 * * * *', tracedHandler);

  logger.info('[StaleOrderWorker] Stale order cleanup cron job scheduled (runs every hour).');
  return staleOrderWorkerTask;
};

/**
 * Run one stale-order sweep.
 *
 * Replica admission: a Redis owner-token lease plus a local guard stops new
 * work after observed ownership loss. Already-started operations cannot be
 * fenced by this lease. Per-order safety is enforced by the
 * atomic `cancel_stale_order_tx` RPC: it locks the order row FOR UPDATE and
 * only cancels an order that is still 'pending' and older than the cutoff, so
 * a concurrent bid acceptance (which also locks the row) produces exactly one
 * valid winner. Side effects (load-offer cancellation, customer notification)
 * run ONLY when the RPC returns the cancelled row; a lost race returns zero
 * rows and is treated as expected, never as an error.
 */
export async function reconcileStaleOrders(repository) {
  if (!repository) throw new Error('reconcileStaleOrders requires an OrderRepository instance');
  if (staleOrderRunning) return;
  staleOrderRunning = true;
  let globalLockAcquired = false;
  const leaseClient = redisClient;
  const ownerToken = randomUUID();
  let leaseLost = false;
  let leaseDeadline = 0;
  let renewal = null;
  let heartbeat = null;

  // Loss is irreversible for this run. A slow positive renewal response cannot
  // revive locally expired admission; Redis alone cannot fence an in-flight CAS.
  function retainLease() {
    if (!leaseClient) return Promise.resolve(!leaseLost);
    if (leaseLost || performance.now() >= leaseDeadline) {
      leaseLost = true;
      return Promise.resolve(false);
    }
    if (renewal) return renewal;
    const started = performance.now();
    const previousDeadline = leaseDeadline;
    renewal = (async () => {
      try {
        const retained = await leaseClient.eval(RENEW_LOCK_SCRIPT, 1, LOCK_KEY, ownerToken, LOCK_TTL_SECONDS);
        if (retained !== 1 || performance.now() >= previousDeadline) leaseLost = true;
        if (!leaseLost) leaseDeadline = started + LOCK_TTL_SECONDS * 1000;
      } catch (err) {
        leaseLost = true;
        logger.warn('[StaleOrderWorker] Failed to refresh lock; stopping further admission:', err.message);
      }
      return !leaseLost;
    })().finally(() => { renewal = null; });
    return renewal;
  }

  try {
    if (leaseClient) {
      const started = performance.now();
      try {
        globalLockAcquired = await leaseClient.set(LOCK_KEY, ownerToken, 'NX', 'EX', LOCK_TTL_SECONDS) === 'OK';
      } catch (err) {
        logger.error('[StaleOrderWorker] Failed to acquire Redis global lock, skipping batch:', err.message);
        return;
      }
      if (!globalLockAcquired) {
        logger.info('[StaleOrderWorker] Global lock held by another replica, skipping batch.');
        return;
      }
      leaseDeadline = started + LOCK_TTL_SECONDS * 1000;
      if (performance.now() >= leaseDeadline) {
        leaseLost = true;
        return;
      }
      heartbeat = setInterval(() => { void retainLease(); }, LOCK_TTL_SECONDS * 1000 / 3);
      heartbeat.unref?.();
    }

    const staleSince = new Date(Date.now() - DEFAULT_STALE_ORDER_AGE_MS).toISOString();
    const configuredBatch = Number(process.env.STALE_ORDER_WORKER_BATCH_SIZE);
    const batchSize = Number.isFinite(configuredBatch) && configuredBatch >= 1
      ? Math.min(MAX_BATCH_SIZE, Math.floor(configuredBatch)) : DEFAULT_BATCH_SIZE;

    // The SELECT is only a hint of candidates; cancel_stale_order_tx is the
    // atomic gate. Bounded batch avoids scanning the whole table per sweep.
    const { data: staleOrderIds, error: fetchError } = await repository.findStalePendingOrders(staleSince, batchSize);

    if (fetchError) {
      logger.error(`[StaleOrderWorker] Error fetching stale orders: ${fetchError.message}`);
      return;
    }

    const staleOrders = (staleOrderIds ?? []).slice(0, batchSize);
    if (staleOrders.length === 0) {
      logger.info('[StaleOrderWorker] No stale orders found.');
      return;
    }

    logger.info(`[StaleOrderWorker] Found ${staleOrders.length} stale pending orders. Cancelling...`);

    const metrics = { found: staleOrders.length, cancelled: 0, skipped: 0, errors: 0 };

    let index = 0;
    async function workerPool() {
      while (!leaseLost && index < staleOrders.length) {
        const currentIndex = index++;
        const order = staleOrders[currentIndex];
        if (order && order.id) {
          if (!await retainLease() || leaseLost) return;
          await cancelStaleOrder(order, staleSince, repository, metrics);
        }
      }
    }

    const poolSize = Math.min(CONCURRENCY_LIMIT, staleOrders.length);
    await Promise.all(Array.from({ length: poolSize }, () => workerPool()));

    spanFactory.getActiveSpan()?.setAttributes({
      'stale_orders.found': metrics.found,
      'stale_orders.cancelled': metrics.cancelled,
      'stale_orders.skipped': metrics.skipped,
      'stale_orders.errors': metrics.errors,
    });

    logger.info(
      `[StaleOrderWorker] Cleanup completed: ${metrics.cancelled} cancelled, ${metrics.skipped} skipped, ${metrics.errors} errors.`
    );
  } catch (err) {
    logger.error(`[StaleOrderWorker] Unexpected error during cleanup: ${err.message}`);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    // Pool work has settled before this finally block; drain any renewal too.
    if (renewal) await renewal;
    if (globalLockAcquired && leaseClient) {
      try {
        await leaseClient.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY, ownerToken);
      } catch (err) {
        logger.warn('[StaleOrderWorker] Failed to release global lock:', err.message);
      }
    }
    staleOrderRunning = false;
  }
}

/**
 * Cancel a single stale order without racing concurrent bid acceptance.
 *
 * The atomic `cancel_stale_order_tx` RPC is the serialisation point: it locks
 * the order row FOR UPDATE (the same lock accept_bid_tx / confirm-deposit /
 * cancel_order_tx take) and only cancels an order that is still 'pending' and
 * older than the cutoff. A lost race returns zero rows — that is the expected
 * outcome and MUST NOT trigger any side effect (no load-offer update, no
 * notification, no refund submission).
 *
 * @returns {Promise<void>}
 */
async function cancelStaleOrder(staleOrder, staleSince, repository, metrics) {
  if (!staleOrder || !staleOrder.id) {
    return;
  }

  try {
    const { data: cancelled, error: rpcErr } = await repository.cancelStaleOrder(
      staleOrder.id,
      STALE_ORDER_CANCELLATION_REASON,
      staleSince,
      supabaseAdmin || supabase
    );

    if (rpcErr) {
      metrics.errors += 1;
      logger.error(`[StaleOrderWorker] Failed to cancel order ${staleOrder.id}: ${rpcErr.message}`);
      return;
    }

    const won = Array.isArray(cancelled) ? (cancelled.length > 0 && Boolean(cancelled[0])) : Boolean(cancelled);
    if (!won) {
      metrics.skipped += 1;
      logger.info(`[StaleOrderWorker] Order ${staleOrder.id} was not cancelled (accepted or changed concurrently), skipping side effects.`);
      return;
    }

    const order = Array.isArray(cancelled) ? cancelled[0] : cancelled;
    if (!order) {
      metrics.skipped += 1;
      return;
    }

    metrics.cancelled += 1;

    const orderDisplayId = order.order_display_id ?? staleOrder.order_display_id;
    // Orders whose escrow has funds to refund (for customer messaging), but an
    // on-chain refund must ONLY be submitted when the escrow is still 'funded'.
    // Orders in 'refund_pending' / 'refund_failed' are already being handled by
    // the reconciliation worker; re-submitting here would double-refund.
    const requiresRefund = ['funded', 'refund_pending', 'refund_failed'].includes(order.escrow_status ?? 'pending');
    const canSubmitRefund = (order.escrow_status ?? 'pending') === 'funded';

    // Cancel associated load offers (guarded on nothing — the order is now
    // cancelled, so its offers can never be fulfilled).
    await repository.updateLoadOffer(orderDisplayId, { status: 'cancelled' }).catch((offerErr) => {
      logger.warn(`[StaleOrderWorker] Failed to cancel load offer for order ${orderDisplayId}: ${offerErr.message}`);
    });

    // For escrow-backed orders, actually submit the on-chain refund before
    // telling the customer their funds are being returned. Only claim a refund
    // is in progress once a transaction hash is obtained.
    let refundSubmitted = false;
    if (canSubmitRefund) {
      try {
        const refundResult = await submitEscrowRefund(orderDisplayId);
        refundSubmitted = Boolean(refundResult && refundResult.txHash);
        if (!refundSubmitted) {
          logger.warn(
            `[StaleOrderWorker] Escrow refund for order ${orderDisplayId} was not submitted (${refundResult && refundResult.error ? refundResult.error : 'no txHash'}); customer will be told a refund will be processed.`
          );
        }
      } catch (refundErr) {
        logger.error(`[StaleOrderWorker] Failed to submit escrow refund for order ${orderDisplayId}: ${refundErr.message}`);
      }
    }

    // Send a notification to the customer
    if (order.customer_id) {
      try {
        await sendPushNotification(
          order.customer_id,
          'Order Cancelled',
          requiresRefund
            ? `Your order ${orderDisplayId} was cancelled because it was not completed in time. Any escrowed funds are being refunded.`
            : 'Your order was cancelled because it received no accepted bids within 24 hours. Please try posting again.',
          'order_update',
          { orderId: order.id ?? staleOrder.id, orderDisplayId }
        );
        logger.info(`[StaleOrderWorker] Cancelled order ${orderDisplayId} and notified customer ${order.customer_id}.`);
      } catch (notifyErr) {
        logger.warn(`[StaleOrderWorker] Cancelled order ${orderDisplayId}, but failed to notify customer ${order.customer_id}: ${notifyErr.message}`);
      }
    }
  } catch (err) {
    metrics.errors += 1;
    logger.error(`[StaleOrderWorker] Error processing stale order ${staleOrder?.id}: ${err.message}`);
  }
}

export const stopStaleOrderWorker = () => {
  if (!staleOrderWorkerTask) return;

  staleOrderWorkerTask.stop();
  staleOrderWorkerTask = null;
  logger.info('[StaleOrderWorker] Stale order cleanup cron job stopped.');
};
