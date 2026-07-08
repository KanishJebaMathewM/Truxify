import crypto from 'crypto';
import { supabase, redisClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import {
  sendDeliveryOtpNotification,
  storeDeliveryOtp,
  getActiveDeliveryOtp,
  verifyDeliveryOtp,
} from '../notificationService.js';
import { escrowRelease } from '../escrow.js';
import { DomainError } from './domainError.js';

export const OTP_TTL_MINUTES = parseInt(process.env.OTP_TTL_MINUTES || '15', 10);
const OTP_MAX_FAILED_ATTEMPTS = parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || '5', 10);
export const OTP_LOCKOUT_MINUTES = parseInt(process.env.OTP_LOCKOUT_MINUTES || '30', 10);
const IN_MEMORY_OTP_MAP_MAX_SIZE = parseInt(process.env.IN_MEMORY_OTP_MAP_MAX_SIZE || '10000', 10);
export const DELIVERY_OTP_READY_STATUSES = new Set(['arriving']);

const inMemoryOtpFailedAttempts = new Map();

export async function checkOtpLockout(orderId) {
  if (redisClient) {
    try {
      const lockKey = `otp_lockout:${orderId}`;
      const isLocked = await redisClient.get(lockKey);
      return !!isLocked;
    } catch (err) {
      logger.error('[OTP] Redis error in checkOtpLockout, falling back to memory:', err.message);
    }
  }
  const record = inMemoryOtpFailedAttempts.get(orderId);
  if (!record || !record.lockedUntil) return false;
  if (Date.now() >= record.lockedUntil) {
    inMemoryOtpFailedAttempts.delete(orderId);
    return false;
  }
  return true;
}

export async function recordOtpFailure(orderId) {
  if (redisClient) {
    try {
      const countKey = `otp_failed_count:${orderId}`;
      const lockKey = `otp_lockout:${orderId}`;

      const count = await redisClient.incr(countKey);
      if (count === 1) await redisClient.expire(countKey, OTP_LOCKOUT_MINUTES * 60);
      if (count >= OTP_MAX_FAILED_ATTEMPTS) {
        await redisClient.set(lockKey, '1', 'EX', OTP_LOCKOUT_MINUTES * 60);
      }
      return count;
    } catch (err) {
      logger.error('[OTP] Redis error in recordOtpFailure, falling back to memory:', err.message);
    }
  }

  if (inMemoryOtpFailedAttempts.size >= IN_MEMORY_OTP_MAP_MAX_SIZE) {
    const oldestKey = inMemoryOtpFailedAttempts.keys().next().value;
    inMemoryOtpFailedAttempts.delete(oldestKey);
  }

  let record = inMemoryOtpFailedAttempts.get(orderId);
  if (!record) {
    record = { count: 0, lockedUntil: null };
    inMemoryOtpFailedAttempts.set(orderId, record);
  }
  record.count += 1;
  if (record.count >= OTP_MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000;
  }
  return record.count;
}

export async function clearOtpState(orderId) {
  if (redisClient) {
    try {
      const countKey = `otp_failed_count:${orderId}`;
      const lockKey = `otp_lockout:${orderId}`;
      await redisClient.del(countKey, lockKey);
      return;
    } catch (err) {
      logger.error('[OTP] Redis error in clearOtpState, falling back to memory:', err.message);
    }
  }
  inMemoryOtpFailedAttempts.delete(orderId);
}

export class OrderMilestoneService {
  constructor({ orderValidationService } = {}) {
    this.validation = orderValidationService;
  }

  async updateMilestone({ orderId, milestone, driverId }) {
    const milestoneMap = {
      'Truck Assigned': 'truck_assigned',
      'En Route to Pickup': 'en_route_pickup',
      'Arrived at Pickup': 'arrived_pickup',
      'Goods Loaded': 'picked_up',
      'In Transit': 'in_transit',
      'Arriving': 'arriving',
    };

    if (milestone === 'Delivered') {
      throw new DomainError(400, { error: 'Cannot set Delivered milestone directly. Use /verify-delivery endpoint to confirm delivery.' });
    }

    const { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderErr || !order) throw new DomainError(404, { error: 'Order not found.' });
    if (order.driver_id !== driverId) throw new DomainError(403, { error: 'Access Denied: You are not assigned to this order.' });

    const { data: timeline, error: tlErr } = await supabase
      .from('order_timeline')
      .select('milestone, sort_order, completed')
      .eq('order_display_id', order.order_display_id)
      .order('sort_order', { ascending: true });
    if (tlErr) throw new DomainError(500, { error: 'Failed to fetch order timeline.' });

    const canonicalMilestones = new Set([...Object.keys(milestoneMap), 'Order Placed', 'Delivered']);
    const lastCompleted = [...timeline].reverse().find(t => t.completed && canonicalMilestones.has(t.milestone));
    const lastCompletedSortOrder = lastCompleted ? lastCompleted.sort_order : 10;

    const timelineEntry = timeline.find(t => t.milestone === milestone);
    if (!timelineEntry) throw new DomainError(400, { error: `Milestone "${milestone}" is not part of this order's timeline.` });

    if (timelineEntry.completed) {
      throw new DomainError(409, { error: `Milestone "${milestone}" has already been completed.` });
    }

    const nextExpected = timeline.find(t => !t.completed && t.sort_order > lastCompletedSortOrder);
    if (!nextExpected || nextExpected.sort_order !== timelineEntry.sort_order) {
      throw new DomainError(422, {
        error: `Milestone out of sequence. Expected "${nextExpected ? nextExpected.milestone : 'none'}" before "${milestone}".`,
      });
    }

    const status = milestoneMap[milestone];
    const updates = { status, updated_at: new Date().toISOString() };
    let generatedOtp = null;

    if (milestone === 'In Transit') {
      const activeOtp = await getActiveDeliveryOtp(orderId);
      if (!activeOtp) {
        generatedOtp = crypto.randomInt(100000, 1000000).toString();
        const stored = await storeDeliveryOtp(orderId, generatedOtp, OTP_TTL_MINUTES);
        if (stored) {
          await clearOtpState(orderId);
        }
      } else {
        logger.warn(`[OTP] Driver ${driverId} attempted OTP regeneration for order ${orderId}`);
      }
    }

    const { error: timelineErr } = await supabase.from('order_timeline').update({ completed: true, milestone_time: new Date().toISOString() }).eq('order_display_id', order.order_display_id).eq('milestone', milestone);
    if (timelineErr) throw new DomainError(500, { error: 'Failed to update order timeline.', details: timelineErr.message });

    const { data: updatedOrder, error: updateErr } = await supabase.from('orders').update(updates).eq('id', orderId).select('*').single();
    if (updateErr) {
      await supabase
        .from('order_timeline')
        .update({ completed: false, milestone_time: null })
        .eq('order_display_id', order.order_display_id)
        .eq('milestone', milestone);
      throw new DomainError(500, { error: 'Failed to update order.', details: updateErr.message });
    }

    if (generatedOtp) {
      const notifResult = await sendDeliveryOtpNotification(order.customer_id, order.order_display_id, generatedOtp);
      if (!notifResult.success) {
        logger.warn(`[OrderRoutes] Delivery OTP notification failed for order ${order.order_display_id} — FCM error: ${notifResult.fcm?.error || 'unknown'}`);
        await supabase.from('orders').update({
          notification_failed: true,
          updated_at: new Date().toISOString(),
        }).eq('id', orderId);
      }
    }

    return { order: updatedOrder, milestone, status };
  }

  async verifyDelivery({ orderId, otp, driverId }) {
    if (await checkOtpLockout(orderId)) {
      throw new DomainError(429, {
        error: `Too many failed OTP attempts. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes.`,
      });
    }

    const { data: order, error: orderErr } = await supabase.from('orders')
      .select('id, order_display_id, driver_id, customer_id, escrow_status, escrow_release_attempts, status')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr || !order) throw new DomainError(404, { error: 'Order not found.' });
    if (order.driver_id !== driverId) throw new DomainError(403, { error: 'Access Denied: You are not assigned to this order.' });
    if (!DELIVERY_OTP_READY_STATUSES.has(order.status)) {
      throw new DomainError(409, { error: 'Delivery OTP can only be verified after the shipment reaches the delivery location.' });
    }

    const otpRecord = await getActiveDeliveryOtp(orderId);
    if (!otpRecord) {
      throw new DomainError(400, {
        error: 'OTP not available or has expired. Please request a new delivery OTP.',
      });
    }

    const submittedHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    let isMatch = false;
    if (otpRecord.otp_hash && otpRecord.otp_hash.length === submittedHash.length) {
      isMatch = crypto.timingSafeEqual(
        Buffer.from(otpRecord.otp_hash, 'hex'),
        Buffer.from(submittedHash, 'hex')
      );
    }
    if (!isMatch) {
      const count = await recordOtpFailure(orderId);
      const remaining = Math.max(0, OTP_MAX_FAILED_ATTEMPTS - count);
      const message = remaining > 0
        ? `Invalid OTP. ${remaining} attempt(s) remaining before lockout.`
        : `Invalid OTP. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes due to too many failed attempts.`;
      logger.warn(`[OTP] Failed verification attempt for order ${orderId} by driver ${driverId}. ${remaining} attempts remaining.`);
      throw new DomainError(400, { error: message });
    }

    const { data: preUpdatedOrder, error: updateErr } = await supabase.from('orders').update({
      updated_at: new Date().toISOString()
    })
      .eq('id', orderId)
      .not('status', 'eq', 'cancelled')
      .not('status', 'eq', 'payment_released')
      .select('id, order_display_id, status')
      .single();

    if (updateErr) {
      if (updateErr.code === 'PGRST116') {
        throw new DomainError(409, { error: 'Order was already cancelled or payment released.' });
      }
      throw new DomainError(500, { error: 'Failed to verify OTP.', details: updateErr.message });
    }

    let releaseTxHash = null;
    let escrowAlreadyReleased = false;
    if (order.escrow_status === 'funded' || order.escrow_status === 'release_failed') {
      try {
        const releaseResult = await escrowRelease(order.order_display_id);
        if (releaseResult.txHash) {
          releaseTxHash = releaseResult.txHash;
        } else if (releaseResult.alreadyReleased) {
          escrowAlreadyReleased = true;
        } else {
          throw new Error('Escrow release returned no transaction hash');
        }
      } catch (releaseErr) {
        logger.error('[escrow] Blockchain release failed for order', orderId, ':', releaseErr.message);
        throw new DomainError(503, {
          error: 'Blockchain escrow release failed. Payment cannot be processed. Please retry.',
          retryable: true,
        });
      }
    } else {
      logger.info(`[escrow] Escrow not funded (status: ${order.escrow_status}) — skipping on-chain release.`);
    }

    const { data: tripData, error: rpcErr } = await supabase.rpc('complete_trip_tx', {
      p_order_id: orderId,
      p_otp_id: otpRecord.id,
      p_release_tx_hash: releaseTxHash,
    });
    if (rpcErr) {
      logger.error('complete_trip_tx RPC failed:', rpcErr.message);
      throw new DomainError(500, { error: 'Failed to complete trip and release payment.', details: rpcErr.message });
    }

    const { data: verifiedOrder, error: verifyErr } = await supabase
      .from('orders')
      .select('status, escrow_status, escrow_release_attempts')
      .eq('id', orderId)
      .maybeSingle();

    if (verifyErr || !verifiedOrder) {
      logger.error(`[verify-delivery] Failed to verify order status after RPC for order ${orderId}`);
      throw new DomainError(500, { error: 'Failed to verify order status after payment release.' });
    }

    if (verifiedOrder.status !== 'payment_released') {
      logger.warn(`[verify-delivery] Order ${orderId} status changed to "${verifiedOrder.status}" — payment was not released.`);
      throw new DomainError(409, {
        error: 'Order status changed during processing. Payment was not released.',
      });
    }

    await verifyDeliveryOtp(otpRecord.id);
    await clearOtpState(orderId);

    if (releaseTxHash || escrowAlreadyReleased) {
      const { error: releaseUpdateErr } = await supabase.from('orders').update({
        escrow_status: 'released',
        escrow_release_error: null,
        escrow_released_at: new Date().toISOString(),
        release_tx_hash: releaseTxHash,
      }).eq('id', orderId);

      if (releaseUpdateErr) {
        logger.error('[escrow] Release confirmed but persistence failed:', releaseUpdateErr.message);
        return { status: 202, body: { message: 'Delivery verified successfully. Escrow payout requires reconciliation.', escrow_status: 'released', payment_released: true } };
      }

      const driverIdVal = tripData?.driver_id || order.driver_id;
      const displayId = tripData?.order_display_id || order.order_display_id;
      if (driverIdVal) {
        const { error: walletErr } = await supabase
          .from('wallet_transactions')
          .update({ description: `Escrow payout for ${displayId}` })
          .eq('driver_id', driverIdVal)
          .eq('order_display_id', displayId)
          .eq('txn_type', 'credit');

        if (walletErr) {
          logger.error('[wallet] Failed to persist escrow payout:', walletErr.message);
        }
      }
    }

    return { status: 200, body: { message: 'Delivery verified successfully! Payment released to driver.' } };
  }
}
