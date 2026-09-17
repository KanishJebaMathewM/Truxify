import { supabaseAdmin } from '../../config/db.js';
import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';
import {
  normalizeTxHash,
  verifyPolygonEscrowTransaction,
  verifyPolygonWithdrawalTransaction,
  EscrowVerificationError,
} from './escrowVerification.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Escrow statuses a release/withdrawal webhook may legitimately reconcile.
const RELEASE_RECONCILABLE_STATUSES = ['funded', 'release_failed'];
// Escrow statuses a cancellation/refund webhook may legitimately reconcile.
const REFUND_RECONCILABLE_STATUSES = ['funded', 'refund_pending', 'refund_failed'];
const RELEASE_TARGET_STATUSES = [...RELEASE_RECONCILABLE_STATUSES, 'released'];
const REFUND_TARGET_STATUSES = [...REFUND_RECONCILABLE_STATUSES, 'refunded'];

const ORDER_COLUMNS =
  'id, order_display_id, driver_id, escrow_status, release_tx_hash, refund_tx_hash, escrow_amount_wei, escrow_disabled, status';

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
  const columns = 'id, order_display_id, driver_id, escrow_status, release_tx_hash, refund_tx_hash, escrow_amount_wei, escrow_booking_id, bid_amount, total_amount';

  if (UUID_REGEX.test(orderId)) {
    const { data, error } = await db
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('id', orderId)
      .maybeSingle();
    if (!error && data) {
      return data;
    }
  }

  const { data, error } = await db
    .from('orders')
    .select(ORDER_COLUMNS)
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
  const { data, error } = await requireDb()
    .from('wallet_transactions')
    .update({
      status: 'confirmed',
      description: `Escrow payout for ${order.order_display_id}`,
    })
    .eq('driver_id', order.driver_id)
    .eq('order_display_id', order.order_display_id)
    .eq('txn_type', 'credit')
    .select('id');

  if (error) {
    throw new Error(`Failed to reconcile wallet ledger for ${order.order_display_id}: ${error.message}`);
  }

  // The authoritative finalize (`complete_trip_tx`, invoked by `creditDriverWallet`
  // and by the reconciliation worker) inserts the credit directly as 'confirmed',
  // so there is often no 'pending' credit row to reconcile. Do NOT treat a missing
  // pending credit as an error — the driver payout is already confirmed. Only a
  // genuine DB failure above should surface (issue #14685).
  return;
}

// Authoritative driver payout for a verified on-chain release. Runs
// `complete_trip_tx` (service_role, no OTP) which is idempotent on
// `status = 'payment_released'`: it increments `driver_details.wallet_confirmed`
// / `wallet_total` and inserts the confirmed `wallet_transactions` credit row
// exactly once. The webhook has already verified the Polygon release receipt, so
// the supplied release hash is trustworthy (issue #14685).
async function creditDriverWallet(order, txHash) {
  if (!order.driver_id) {
    return;
  }
  const { error } = await requireDb().rpc('complete_trip_tx', {
    p_order_id: order.id,
    p_otp_id: null,
    p_release_tx_hash: txHash || null,
  });

  if (error) {
    throw new Error(
      `Failed to finalize trip and credit driver wallet for ${order.order_display_id}: ${error.message}`
    );
  }
}

// Soft driver-wallet lookup for the on-chain correlation check. Never fatal:
// a failed lookup just skips the soft check (bookingId correlation remains the
// authoritative binding between a transaction and an order).
async function findDriverPolygonWallet(driverId) {
  if (!driverId) return null;
  try {
    const { data, error } = await requireDb()
      .from('driver_details')
      .select('polygon_wallet_address')
      .eq('user_id', driverId)
      .maybeSingle();
    if (error || !data) return null;
    return data.polygon_wallet_address || null;
  } catch (err) {
    logger.warn(`[Webhook] Failed to load driver polygon wallet for ${driverId}: ${err?.message}`);
    return null;
  }
}

// Idempotent duplicate-delivery path: the order-level escrow_status effect
// already happened on the first delivery, so a missing/errored wallet-ledger
// reconcile must not throw here — otherwise the DLQ redelivers forever,
// re-entering this same branch and failing identically each time (permanent
// poison message). Log and swallow so the webhook can be acknowledged; a later
// redelivery retries the (idempotent) reconcile again.
async function tryReconcileWalletLedger(order, txHash) {
  try {
    await reconcileWalletLedger(order, txHash);
  } catch (err) {
    logger.warn(
      { err: err.message, orderDisplayId: order.order_display_id, driverId: order.driver_id },
      '[Webhook] Duplicate delivery: wallet ledger reconcile failed (best-effort) — order-level effect already applied, acknowledging delivery.'
    );
  }
}

async function getPolygonProvider() {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) {
    throw new Error('POLYGON_RPC_URL is not configured for Polygon receipt validation');
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

async function verifyPolygonTransactionReceipt(txHash) {
  const provider = await getPolygonProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Polygon transaction ${txHash} not found`);
  }
  return receipt;
}

function isUniqueViolation(error) {
  if (!error) return false;
  if (String(error.code) === '23505') return true;
  return /duplicate key value violates unique constraint/i.test(error.message || '');
}

function assertEscrowEnabled(order) {
  if (order.escrow_disabled) {
    throw new EscrowVerificationError(
      'ESCROW_DISABLED',
      `Order ${order.order_display_id} is not escrow-backed; refusing to reconcile release webhook`,
      { retryable: false },
    );
  }
  if (order.status === 'cancelled') {
    throw new EscrowVerificationError(
      'ORDER_CANCELLED',
      `Order ${order.order_display_id} is cancelled; refusing to reconcile release webhook`,
      { retryable: false },
    );
  }
}

// Mark an order escrow-released after on-chain verification, protecting against
// the same transaction hash being recorded against a different order (replay).
async function releaseOrder({ order, txHash, now }) {
  const db = requireDb();

  // Pre-emptive replay check. The unique partial index on release_tx_hash is
  // the durable guarantee; this gives a clean permanent error before any write.
  const replayCheck = await db
    .from('orders')
    .select('id, order_display_id')
    .eq('release_tx_hash', txHash)
    .neq('id', order.id)
    .maybeSingle();
  if (replayCheck.error) {
    throw new Error(`Failed to check release_tx_hash replay for ${order.order_display_id}: ${replayCheck.error.message}`);
  }
  if (replayCheck.data) {
    throw new EscrowVerificationError(
      'TX_HASH_REPLAY',
      `Transaction ${txHash} is already recorded against order ${replayCheck.data.order_display_id || replayCheck.data.id}`,
      { retryable: false },
    );
  }

  const { error } = await db
    .from('orders')
    .update({
      escrow_status: 'released',
      release_tx_hash: txHash,
      escrow_released_at: now,
      escrow_release_error: null,
      updated_at: now,
    })
    .eq('id', order.id)
    .in('escrow_status', RELEASE_RECONCILABLE_STATUSES);

  if (error) {
    if (isUniqueViolation(error)) {
      throw new EscrowVerificationError(
        'TX_HASH_REPLAY',
        `Transaction ${txHash} is already recorded against another order`,
        { retryable: false },
      );
    }
    throw new Error(`Failed to mark order ${order.order_display_id} as released: ${error.message}`);
  }

  await reconcileWalletLedger(order, txHash);
  logger.info(`[Webhook] Order ${order.order_display_id} marked escrow released after on-chain verification (tx: ${txHash})`);
}

// Escrow contract events that carry the released/refunded amount. For
// contract-initiated payouts (releasePayment / cancelBooking /
// cancelWithPenalty / resolveDispute) the relayer's `msg.value` is `0` and
// ethers v6 does not even populate a `value` field on the TransactionReceipt —
// so the moved wei MUST be read from the contract's emitted event logs, never
// from `receipt.value`.
const ESCROW_AMOUNT_EVENTS = new ethers.Interface([
  'event PaymentReleased(uint256 indexed bookingId, address indexed driver, uint256 amount)',
  'event BookingCancelled(uint256 indexed bookingId, address indexed customer, uint256 refundAmount)',
  'event WithdrawalReady(uint256 indexed bookingId, address indexed recipient, uint256 amount)',
  'event CancellationPenaltyApplied(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address indexed customer, uint256 refundAmount)',
  'event DisputeResolved(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address indexed customer, uint256 refundAmount)',
]);

// Reads the on-chain released/refunded amount for a given webhook event type
// from the escrow contract's emitted event logs. Returns null when no matching
// event is present (e.g. a malformed or off-contract receipt).
function extractEscrowEventAmount(receipt, eventType) {
  const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  const logs = receipt.logs || [];
  let matched = null;

  for (const log of logs) {
    if (escrowAddress && log.address && String(log.address).toLowerCase() !== String(escrowAddress).toLowerCase()) {
      continue;
    }
    let parsed;
    try {
      parsed = ESCROW_AMOUNT_EVENTS.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed) {
      continue;
    }
    const { name, args } = parsed;
    if (eventType === 'PaymentReleased' && name === 'PaymentReleased') {
      matched = (matched == null ? 0n : matched) + BigInt(args.amount);
    } else if (eventType === 'BookingCancelled') {
      if (name === 'BookingCancelled') {
        matched = (matched == null ? 0n : matched) + BigInt(args.refundAmount);
      } else if (name === 'CancellationPenaltyApplied' || name === 'DisputeResolved') {
        matched = (matched == null ? 0n : matched) + BigInt(args.driverAmount) + BigInt(args.refundAmount);
      }
    } else if ((eventType === 'WithdrawalReady' || eventType === 'Withdrawn') && name === 'WithdrawalReady') {
      matched = (matched == null ? 0n : matched) + BigInt(args.amount);
    }
  }

  return matched;
}

// Asserts the on-chain release/refund transferred exactly the escrowed amount.
// The amount is taken from the escrow contract's emitted event logs (which
// carry the actual moved wei) rather than `receipt.value` — the latter is the
// transaction's `msg.value`, which is `0` for contract-initiated payouts.
// Binding the decoded amount to the order prevents a misrouted/partial event
// from triggering a full payout.
function assertReceiptAmount(receipt, order, eventType) {
  if (order.escrow_amount_wei == null) {
    return;
  }
  const actual = extractEscrowEventAmount(receipt, eventType);
  if (actual == null) {
    throw new Error(
      `Polygon receipt for ${order.order_display_id} carries no ${eventType} amount in its escrow event logs — cannot bind release to escrow amount`
    );
  }
  const expected = BigInt(order.escrow_amount_wei);
  if (actual !== expected) {
    throw new Error(
      `Polygon ${eventType} amount ${actual} wei does not match escrow amount ${expected} wei for order ${order.order_display_id}`
    );
  }
}

// Confirms the release event is bound to this order's escrow booking. When the
// webhook carries an `escrow_booking_id`, it must match the order's on-chain
// booking id — otherwise a misrouted event from a different escrow could flip
// an unrelated order to `released`.
function assertBookingBinding(payload, order) {
  const eventBookingId = payload.escrow_booking_id || payload.bookingId;
  if (!eventBookingId) {
    return;
  }
  const orderBookingId = order.escrow_booking_id;
  if (!orderBookingId) {
    return;
  }
  if (String(eventBookingId).toLowerCase() !== String(orderBookingId).toLowerCase()) {
    throw new Error(
      `Escrow release event booking id ${eventBookingId} does not match order ${order.order_display_id} booking id ${orderBookingId}`
    );
  }
}

async function handlePaymentReleased(payload) {
  if (!payload.txHash) {
    throw new Error('Missing txHash in escrow release webhook payload — release requires on-chain proof');
  }
  const receipt = await verifyPolygonTransactionReceipt(payload.txHash);
  const order = await findOrderByIdOrDisplayId(payload.orderId);
  assertBookingBinding(payload, order);
  assertReceiptAmount(receipt, order, 'PaymentReleased');
  const now = new Date().toISOString();

  // Idempotent duplicate delivery: the release was already applied. Re-confirm
  // the (idempotent) wallet ledger so a crash between the order update and the
  // wallet update is healed, then short-circuit without re-applying effects.
  if (order.escrow_status === 'released') {
    const payloadHash = normalizeTxHash(payload.txHash);
    if (order.release_tx_hash) {
      if (payloadHash && payloadHash !== order.release_tx_hash.toLowerCase()) {
        throw new EscrowVerificationError(
          'TX_HASH_CONFLICT',
          `Order ${order.order_display_id} is already released with a different transaction hash`,
          { retryable: false },
        );
      }
      await reconcileWalletLedger(order, order.release_tx_hash);
      logger.info(`[Webhook] Order ${order.order_display_id} already released — duplicate delivery ignored.`);
      return;
    }
    // Released but no hash on file (heal path): verify and persist the evidence.
    if (!payloadHash) {
      throw new EscrowVerificationError(
        'INVALID_TX_HASH',
        'Released order is missing release_tx_hash; a well-formed transaction hash is required to heal it',
        { retryable: false },
      );
    }
    assertEscrowEnabled(order);
    const verification = await verifyPolygonEscrowTransaction({
      txHash: payloadHash,
      orderDisplayId: order.order_display_id,
      driverWalletAddress: await findDriverPolygonWallet(order.driver_id),
      expectedAmountWei: order.escrow_amount_wei,
    });
    const { error } = await requireDb()
      .from('orders')
      .update({ release_tx_hash: verification.txHash, updated_at: now })
      .eq('id', order.id)
      .eq('escrow_status', 'released');
    if (error) {
      if (isUniqueViolation(error)) {
        throw new EscrowVerificationError(
          'TX_HASH_REPLAY',
          `Transaction ${verification.txHash} is already recorded against another order`,
          { retryable: false },
        );
      }
      throw new Error(`Failed to persist release_tx_hash for ${order.order_display_id}: ${error.message}`);
    }
    await reconcileWalletLedger(order, verification.txHash);
    logger.info(`[Webhook] Order ${order.order_display_id} release_tx_hash healed after on-chain verification (tx: ${verification.txHash})`);
    await tryReconcileWalletLedger(order, payload.txHash || order.release_tx_hash);
    await reconcileWalletLedger(order, payload.txHash || order.release_tx_hash);
    logger.info(`[Webhook] Order ${order.order_display_id} already released — duplicate delivery ignored.`);
    return;
  }

  // Active path: the order is not yet released. Refuse orders that cannot be
  // released and require a well-formed hash BEFORE any on-chain or DB work.
  assertEscrowEnabled(order);
  if (!RELEASE_RECONCILABLE_STATUSES.includes(order.escrow_status)) {
    throw new EscrowVerificationError(
      'UNEXPECTED_ESCROW_STATUS',
      `Order ${order.order_display_id} has escrow_status ${order.escrow_status}; cannot be released by PaymentReleased webhook`,
      { retryable: false },
    );
  }
  const txHash = normalizeTxHash(payload.txHash);
  if (!txHash) {
    throw new EscrowVerificationError(
      'INVALID_TX_HASH',
      'PaymentReleased webhook requires a well-formed 32-byte transaction hash (0x + 64 hex chars)',
      { retryable: false },
    );
  }

  const verification = await verifyPolygonEscrowTransaction({
    txHash,
    orderDisplayId: order.order_display_id,
    driverWalletAddress: await findDriverPolygonWallet(order.driver_id),
    expectedAmountWei: order.escrow_amount_wei,
  });

  await releaseOrder({ order, txHash: verification.txHash, now });
  const { data: updatedOrders, error } = await requireDb()
    .from('orders')
    .update({
      escrow_status: 'released',
      release_tx_hash: payload.txHash || order.release_tx_hash || null,
      escrow_released_at: now,
      escrow_release_error: null,
      updated_at: now,
    })
    .eq('id', order.id)
    .in('escrow_status', RELEASE_RECONCILABLE_STATUSES)
    .select('id');

  if (error) {
    throw new Error(`Failed to mark order ${order.order_display_id} as released: ${error.message}`);
  }

  if (!updatedOrders || updatedOrders.length === 0) {
    throw new Error(
      `Order ${order.order_display_id} was not updated when marking as released — ` +
        `escrow_status not in reconcilable set (${RELEASE_RECONCILABLE_STATUSES.join(', ')})`
    );
  }

  await creditDriverWallet(order, payload.txHash);
  await reconcileWalletLedger(order, payload.txHash);
  logger.info(`[Webhook] Order ${order.order_display_id} marked escrow released (tx: ${payload.txHash})`);
}

async function handleBookingCancelled(payload) {
  const order = await findOrderByIdOrDisplayId(payload.orderId);
  const now = new Date().toISOString();

  if (order.escrow_status === 'refunded') {
    if (payload.txHash && !order.refund_tx_hash) {
      await requireDb().from('orders').update({ refund_tx_hash: payload.txHash }).eq('id', order.id);
    }
    logger.info(`[Webhook] Order ${order.order_display_id} already refunded — duplicate delivery ignored.`);
    return;
  }
  if (!REFUND_RECONCILABLE_STATUSES.includes(order.escrow_status)) {
    throw new EscrowVerificationError(
      'UNEXPECTED_ESCROW_STATUS',
      `Order ${order.order_display_id} has escrow_status ${order.escrow_status}; cannot be refunded by BookingCancelled webhook`,
      { retryable: false },
    );
  }

  // Verify the on-chain cancellation/refund actually moved the escrow amount.
  // Like a payout, a contract-initiated cancel has msg.value === 0, so the
  // released/refunded wei is read from the BookingCancelled /
  // CancellationPenaltyApplied event logs rather than receipt.value.
  if (payload.txHash) {
    const receipt = await verifyPolygonTransactionReceipt(payload.txHash);
    assertReceiptAmount(receipt, order, 'BookingCancelled');
  }

  const { data: updatedOrders, error } = await requireDb()
    .from('orders')
    .update({
      escrow_status: 'refunded',
      refund_tx_hash: payload.txHash || order.refund_tx_hash || null,
      updated_at: now,
    })
    .eq('id', order.id)
    .in('escrow_status', REFUND_RECONCILABLE_STATUSES)
    .select('id');

  if (error) {
    throw new Error(`Failed to mark order ${order.order_display_id} as refunded: ${error.message}`);
  }

  if (!updatedOrders || updatedOrders.length === 0) {
    throw new Error(
      `Order ${order.order_display_id} was not updated when marking as refunded — ` +
        `escrow_status not in reconcilable set (${REFUND_RECONCILABLE_STATUSES.join(', ')})`
    );
  }

  logger.info(`[Webhook] Order ${order.order_display_id} marked escrow refunded (tx: ${payload.txHash})`);
}

// WithdrawalReady / Withdrawn: the escrowed funds were settled via the
// pull-based withdrawal path (e.g. a driver's direct withdraw()). Reconcile
// the order based on its current escrow state.
async function handleWithdrawalSettled(payload) {
  const order = await findOrderByIdOrDisplayId(payload.orderId);
  const now = new Date().toISOString();
  const txHash = normalizeTxHash(payload.txHash);

  const isRefund = ['refund_pending', 'refund_failed'].includes(order.escrow_status);
  const targetStatus = isRefund ? 'refunded' : 'released';
  const targetStatuses = isRefund ? REFUND_TARGET_STATUSES : RELEASE_TARGET_STATUSES;

  // Idempotent duplicate delivery: the withdrawal was already reconciled.
  if (order.escrow_status === targetStatus) {
    if (txHash && order.release_tx_hash && txHash !== order.release_tx_hash.toLowerCase()) {
      throw new EscrowVerificationError(
        'TX_HASH_CONFLICT',
        `Order ${order.order_display_id} is already ${targetStatus} with a different transaction hash`,
        { retryable: false },
      );
    }
    if (txHash) {
      if (isRefund && !order.refund_tx_hash) {
        await requireDb().from('orders').update({ refund_tx_hash: txHash }).eq('id', order.id);
      } else if (!isRefund && !order.release_tx_hash) {
        await requireDb().from('orders').update({ release_tx_hash: txHash }).eq('id', order.id);
      }
    }
    if (!isRefund) {
      await reconcileWalletLedger(order, txHash || order.release_tx_hash);
      await tryReconcileWalletLedger(order, txHash);
      await reconcileWalletLedger(order, txHash);
    }
    logger.info(`[Webhook] Order ${order.order_display_id} already ${targetStatus} — duplicate delivery ignored.`);
    return;
  }

  assertEscrowEnabled(order);
  if (!targetStatuses.includes(order.escrow_status)) {
    throw new EscrowVerificationError(
      'UNEXPECTED_ESCROW_STATUS',
      `Order ${order.order_display_id} has escrow_status ${order.escrow_status}; cannot be reconciled by withdrawal webhook`,
      { retryable: false },
    );
  }
  if (!txHash) {
    throw new EscrowVerificationError(
      'INVALID_TX_HASH',
      'Withdrawal webhook requires a well-formed 32-byte transaction hash (0x + 64 hex chars)',
      { retryable: false },
    );
  }

  const verification = await verifyPolygonWithdrawalTransaction({ txHash });

  const settlement = isRefund
    ? { escrow_status: 'refunded', refund_tx_hash: verification.txHash, updated_at: now }
    : {
        escrow_status: 'released',
        release_tx_hash: verification.txHash,
        escrow_released_at: now,
        escrow_release_error: null,
        updated_at: now,
      };

  const { data: updatedOrders, error } = await requireDb()
    .from('orders')
    .update(settlement)
    .update({
      escrow_status: isRefund ? 'refunded' : 'released',
      release_tx_hash: isRefund ? undefined : (txHash || order.release_tx_hash || null),
      refund_tx_hash: isRefund ? (txHash || order.refund_tx_hash || null) : undefined,
      escrow_released_at: isRefund ? undefined : now,
      escrow_release_error: isRefund ? undefined : null,
      updated_at: now,
    })
    .update({ ...settlement, updated_at: now })
    .eq('id', order.id)
    .in('escrow_status', [...REFUND_RECONCILABLE_STATUSES, ...RELEASE_RECONCILABLE_STATUSES])
    .select('id');

  if (error) {
    if (!isRefund && isUniqueViolation(error)) {
      throw new EscrowVerificationError(
        'TX_HASH_REPLAY',
        `Transaction ${verification.txHash} is already recorded against another order`,
        { retryable: false },
      );
    }
    throw new Error(`Failed to settle order ${order.order_display_id} from withdrawal webhook: ${error.message}`);
  }

  if (!updatedOrders || updatedOrders.length === 0) {
    throw new Error(
      `Order ${order.order_display_id} was not updated when settling from withdrawal webhook — ` +
        `escrow_status not in reconcilable set (${[...REFUND_RECONCILABLE_STATUSES, ...RELEASE_RECONCILABLE_STATUSES].join(', ')})`
    );
  }

  if (!isRefund) {
    await reconcileWalletLedger(order, verification.txHash);
  }

  logger.info(`[Webhook] Order ${order.order_display_id} settled as ${isRefund ? 'refunded' : 'released'} after on-chain verification (tx: ${verification.txHash})`);
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

  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    logger.warn(`[Webhook] No handler registered for escrow event ${eventType} — acknowledging without state change.`);
    return { received: true };
  }

  await handler(payload);
  return { received: true };
}
