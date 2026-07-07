import { supabase, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { recordDepositTx, escrowRelease, submitEscrowRefund, confirmEscrowRefund } from './escrow.js';
import { acquireLock, releaseLock } from '../lib/redisLock.js';
import os from 'os';

const DEFAULT_INTERVAL_MS = 60_000;
const LOCK_KEY = 'escrow:reconciliation:lock';
const LOCK_TTL_SECONDS = 120;
const MAX_RETRIES = 10;
let reconciliationTimer = null;
let reconciliationRunning = false;

export async function reconcileEscrowStates() {
  if (reconciliationRunning) return;
  reconciliationRunning = true;

  try {
    let globalLockAcquired = false;
    if (redisClient) {
      globalLockAcquired = await redisClient.set(LOCK_KEY, process.pid.toString(), 'NX', 'EX', LOCK_TTL_SECONDS);
      if (!globalLockAcquired) {
        logger.info('[escrow-reconciliation] Global lock held by another instance, skipping batch pull.');
        return;
      }
    }

    const instanceId = process.env.HOSTNAME || os.hostname();
    
    // Fetch orders needing reconciliation
    const { data: pendingOrders, error } = await supabase
      .from('orders')
      .select('id, order_display_id, escrow_status, deposit_tx_hash, refund_tx_hash, escrow_refund_retry_count, escrow_release_attempts')
      .in('escrow_status', ['deposit_pending', 'release_pending', 'release_failed', 'refund_pending', 'refund_failed'])
      .limit(50);

    if (error) {
      logger.error('[escrow-reconciliation] Failed to load pending orders:', error.message);
      return;
    }

    for (const order of pendingOrders ?? []) {
      const lockKey = `escrow_lock:${order.id}`;
      const lockValue = await acquireLock(lockKey, 30000); 
      if (!lockValue) continue;

      try {
        if (order.escrow_status === 'deposit_pending') {
          await processDeposit(order);
        } else if (order.escrow_status === 'release_pending' || order.escrow_status === 'release_failed') {
          await processRelease(order);
        } else if (order.escrow_status === 'refund_pending' || order.escrow_status === 'refund_failed') {
          await processRefund(order, instanceId);
        }
      } catch (err) {
        logger.error(`[escrow-reconciliation] Error processing ${order.order_display_id}: ${err.message}`);
      } finally {
        await releaseLock(lockKey, lockValue);
      }
    }

    if (globalLockAcquired && redisClient) {
      try {
        await redisClient.del(LOCK_KEY);
      } catch (err) {
        logger.warn('[escrow-reconciliation] Failed to release global lock:', err.message);
      }
    }
  } finally {
    reconciliationRunning = false;
  }
}

async function processDeposit(order) {
  if (!order.deposit_tx_hash) {
    await supabase.from('orders').update({ escrow_status: 'funding' }).eq('id', order.id);
    return;
  }
  
  const bookingId = `escrow:${order.order_display_id}`;
  const result = await recordDepositTx(bookingId, order.deposit_tx_hash);
  
  if (result.error) {
    await supabase.from('orders').update({ escrow_status: 'funding', deposit_tx_hash: null }).eq('id', order.id);
  } else {
    await supabase.from('orders').update({
      escrow_status: 'funded',
      escrow_deposited_at: new Date().toISOString(),
    }).eq('id', order.id).eq('escrow_status', 'deposit_pending');
  }
}

async function processRelease(order) {
  const releaseAttempts = (order.escrow_release_attempts || 0) + 1;
  if (releaseAttempts >= MAX_RETRIES) return;
  
  try {
    const releaseResult = await escrowRelease(order.order_display_id);
    if (!releaseResult.txHash && !releaseResult.alreadyReleased) {
      throw new Error('Escrow release did not return a transaction hash');
    }

    const txHash = releaseResult.txHash || null;

    // Find the OTP ID
    const { data: otpRecord } = await supabase.from('delivery_otps')
       .select('id')
       .eq('order_id', order.id)
       .order('created_at', { ascending: false })
       .limit(1)
       .maybeSingle();

    if (otpRecord) {
      const { error: rpcErr } = await supabase.rpc('complete_trip_tx', {
        p_order_id: order.id,
        p_otp_id: otpRecord.id,
        p_release_tx_hash: txHash,
      });
      if (rpcErr) {
        // If order was already processed, complete_trip_tx might throw. Handle gracefully.
        logger.warn(`[escrow-reconciliation] complete_trip_tx failed or already done: ${rpcErr.message}`);
      }
    }

    const releasedAt = new Date().toISOString();
    await supabase.from('orders').update({
      escrow_status: 'released',
      release_tx_hash: txHash,
      escrow_release_error: null,
      escrow_released_at: releasedAt,
      escrow_release_attempts: releaseAttempts,
      escrow_release_last_attempt_at: releasedAt,
      updated_at: releasedAt,
    }).eq('id', order.id);

  } catch (err) {
     await supabase.from('orders').update({
      escrow_status: 'release_failed',
      escrow_release_attempts: releaseAttempts,
      escrow_release_error: err.message,
      escrow_release_last_attempt_at: new Date().toISOString(),
    }).eq('id', order.id);
  }
}

async function processRefund(order, instanceId) {
  const retryCount = order.escrow_refund_retry_count ?? 0;
  if (retryCount >= MAX_RETRIES) return;

  try {
    let refundTxHash = order.refund_tx_hash;
    if (!refundTxHash) {
      const submitted = await submitEscrowRefund(order.order_display_id);
      if (submitted.alreadyRefunded) {
          refundTxHash = null;
      } else {
          await submitted.waitForConfirmation();
          refundTxHash = submitted.txHash;
      }
    } else {
      await confirmEscrowRefund(refundTxHash);
    }

    const refundedAt = new Date().toISOString();
    await supabase.from('orders').update({
      status: 'cancelled',
      escrow_status: 'refunded',
      refund_tx_hash: refundTxHash,
      escrow_refunded_at: refundedAt,
      escrow_refund_error: null,
      updated_at: refundedAt,
    }).eq('id', order.id);
  } catch (err) {
    await supabase.from('orders').update({
      escrow_refund_retry_count: retryCount + 1,
      escrow_refund_error: err.message,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);
  }
}

export function startEscrowReconciliation() {
  if (reconciliationTimer) return;
  const configuredInterval = Number(process.env.ESCROW_RECONCILIATION_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;
  reconciliationTimer = setInterval(() => { void reconcileEscrowStates(); }, intervalMs);
  reconciliationTimer.unref?.();
}

export function stopEscrowReconciliation() {
  if (!reconciliationTimer) return;
  clearInterval(reconciliationTimer);
  reconciliationTimer = null;
}
