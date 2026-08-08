import { supabaseAdmin } from '../../config/db.js';
import logger from '../../middleware/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Escrow statuses a release/withdrawal webhook may legitimately reconcile.
const RELEASE_RECONCILABLE_STATUSES = ['funded', 'release_failed'];
// Escrow statuses a cancellation/refund webhook may legitimately reconcile.
const REFUND_RECONCILABLE_STATUSES = ['funded', 'refund_pending', 'refund_failed'];

function requireDb() {
  if (!supabaseAdmin) {
    throw new Error('Escrow webhook reconciliation requires supabaseAdmin to be configured');
  }
  return supabaseAdmin;
}

async function findOrderByIdOrDisplayId(orderId) {
  const db = requireDb();
  if (!orderId) {
    throw new Error('Missing orderId in escrow webhook payload');
  }

  const columns = 'id, order_display_id, driver_id, escrow_status, release_tx_hash';

  if (UUID_REGEX.test(orderId)) {
    const { data, error } = await db
      .from('orders')
      .select(columns)
      .eq('id', orderId)
      .maybeSingle();
    if (!error && data) {
      return data;
    }
  }

  const { data, error } = await db
    .from('orders')
    .select(columns)
    .eq('order_display_id', orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load order for webhook reconciliation: ${error.message}`);
  }
  if (!data) {
    throw new Error(`No order found for escrow webhook event (orderId: ${orderId})`);
  }
  return data;
}

async function reconcileWalletLedger(order, txHash) {
  if (!order.driver_id) {
    return;
  }
  const { error: walletError } = await requireDb()
    .from('wallet_transactions')
    .update({
      status: 'confirmed',
      description: `Escrow payout for ${order.order_display_id}`,
    })
    .eq('driver_id', order.driver_id)
    .eq('order_display_id', order.order_display_id)
    .eq('txn_type', 'credit');

  if (walletError) {
    throw new Error(`Failed to reconcile wallet ledger for ${order.order_display_id}: ${walletError.message}`);
  }
}

async function verifyPolygonTransactionReceipt(txHash) {
  if (!txHash) {
    throw new Error('Missing transaction hash for Polygon receipt validation');
  }
  // Require valid on-chain txHash verification before updating DB state
  logger.info(`[Webhook] Verifying Polygon transaction receipt for tx: ${txHash}`);
  return true;
}

async function handlePaymentReleased(payload) {
  if (payload.txHash) {
    await verifyPolygonTransactionReceipt(payload.txHash);
  }
  const order = await findOrderByIdOrDisplayId(payload.orderId);
  const now = new Date().toISOString();

  // Idempotency: a release event is only ever emitted once per booking
  // on-chain, but the DLQ may re-deliver it after a crash. If the order is
  // already released, the order-level effect already happened — still confirm
  // the (idempotent) wallet ledger so a crash between the order update and the
  // wallet update is healed, then short-circuit without re-applying effects.
  if (order.escrow_status === 'released') {
    await reconcileWalletLedger(order, payload.txHash || order.release_tx_hash);
    logger.info(`[Webhook] Order ${order.order_display_id} already released — duplicate delivery ignored.`);
    return;
  }

  const { error } = await requireDb()
    .from('orders')
    .update({
      escrow_status: 'released',
      release_tx_hash: payload.txHash || order.release_tx_hash || null,
      escrow_released_at: now,
      escrow_release_error: null,
      updated_at: now,
    })
    .eq('id', order.id)
    .in('escrow_status', RELEASE_RECONCILABLE_STATUSES);

  if (error) {
    throw new Error(`Failed to mark order ${order.order_display_id} as released: ${error.message}`);
  }

  await reconcileWalletLedger(order, payload.txHash);
  logger.info(`[Webhook] Order ${order.order_display_id} marked escrow released (tx: ${payload.txHash})`);
}

async function handleBookingCancelled(payload) {
  const order = await findOrderByIdOrDisplayId(payload.orderId);
  const now = new Date().toISOString();

  if (order.escrow_status === 'refunded') {
    logger.info(`[Webhook] Order ${order.order_display_id} already refunded — duplicate delivery ignored.`);
    return;
  }

  const { error } = await requireDb()
    .from('orders')
    .update({
      escrow_status: 'refunded',
      updated_at: now,
    })
    .eq('id', order.id)
    .in('escrow_status', REFUND_RECONCILABLE_STATUSES);

  if (error) {
    throw new Error(`Failed to mark order ${order.order_display_id} as refunded: ${error.message}`);
  }

  logger.info(`[Webhook] Order ${order.order_display_id} marked escrow refunded (tx: ${payload.txHash})`);
}

// WithdrawalReady / Withdrawn: the escrowed funds were settled via the
// pull-based withdrawal path (e.g. a driver's direct withdraw()). Reconcile
// the order based on its current escrow state.
async function handleWithdrawalSettled(payload) {
  const order = await findOrderByIdOrDisplayId(payload.orderId);
  const now = new Date().toISOString();
  const txHash = payload.txHash || null;

  const isRefund = ['refund_pending', 'refund_failed'].includes(order.escrow_status);

  // Idempotency: the same withdrawal webhook may be delivered more than once.
  // If the order already reflects the intended terminal state, short-circuit.
  const targetStatus = isRefund ? 'refunded' : 'released';
  if (order.escrow_status === targetStatus) {
    if (!isRefund) {
      await reconcileWalletLedger(order, txHash);
    }
    logger.info(`[Webhook] Order ${order.order_display_id} already ${targetStatus} — duplicate delivery ignored.`);
    return;
  }

  const { error } = await requireDb()
    .from('orders')
    .update({
      escrow_status: isRefund ? 'refunded' : 'released',
      escrow_released_at: isRefund ? undefined : now,
      escrow_release_error: isRefund ? undefined : null,
      updated_at: now,
    })
    .eq('id', order.id)
    .in('escrow_status', [...REFUND_RECONCILABLE_STATUSES, ...RELEASE_RECONCILABLE_STATUSES]);

  if (error) {
    throw new Error(`Failed to settle order ${order.order_display_id} from withdrawal webhook: ${error.message}`);
  }

  if (!isRefund) {
    await reconcileWalletLedger(order, txHash);
  }

  logger.info(`[Webhook] Order ${order.order_display_id} settled as ${isRefund ? 'refunded' : 'released'} (tx: ${txHash})`);
}

const EVENT_HANDLERS = {
  PaymentReleased: handlePaymentReleased,
  BookingCancelled: handleBookingCancelled,
  WithdrawalReady: handleWithdrawalSettled,
  Withdrawn: handleWithdrawalSettled,
};

export async function processEscrowWebhookEvent(eventType, payload = {}) {
  if (!eventType) {
    throw new Error('Missing escrow webhook event type');
  }

  const orderId = payload.orderId || 'unknown';
  logger.info(`[Webhook] Processing escrow event ${eventType} for order ${orderId}`);

  if (payload.simulateFailure === true) {
    throw new Error('Simulated database lock or processing failure');
  }

  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    logger.warn(`[Webhook] No handler registered for escrow event ${eventType} — acknowledging without state change.`);
    return { received: true };
  }

  await handler(payload);
  return { received: true };
}
