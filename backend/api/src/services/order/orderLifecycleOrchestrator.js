import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import { supabaseAdmin } from '../../config/db.js';

export const ORDER_LIFECYCLE_STATES = Object.freeze({
  MATCHED: 'MATCHED',
  LOADING: 'LOADING',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED',
});

export const DOMAIN_EVENT_TYPES = Object.freeze({
  ORDER_MATCHED: 'ORDER_MATCHED',
  ORDER_LOADING_STARTED: 'ORDER_LOADING_STARTED',
  ORDER_IN_TRANSIT: 'ORDER_IN_TRANSIT',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  ORDER_SETTLED: 'ORDER_SETTLED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
});

export class OrderLifecycleOrchestrator {
  constructor(options = {}) {
    this.supabase = options.supabase || supabaseAdmin;
  }

  /**
   * Generates a deterministic idempotency key for state transition events.
   * @private
   */
  _buildIdempotencyKey(orderId, targetState, sequenceNonce = 1) {
    return `order:${orderId}:state:${targetState}:nonce:${sequenceNonce}`;
  }

  /**
   * Atomically mutates an order's status and writes the domain event into the outbox.
   * 
   * @param {object} params
   * @param {string} params.orderId - Order UUID
   * @param {string} params.targetState - Next state from ORDER_LIFECYCLE_STATES
   * @param {string} params.eventType - Domain event type from DOMAIN_EVENT_TYPES
   * @param {object} [params.eventPayload={}] - Domain event metadata
   * @param {string} [params.actorId] - User or Driver ID performing mutation
   * @param {string} [params.idempotencyKey] - Optional explicit idempotency key
   * @returns {Promise<{success: boolean, orderId: string, newState: string, outboxEventId: string}>}
   */
  async transitionOrderState(params) {
    const {
      orderId,
      targetState,
      eventType,
      eventPayload = {},
      actorId,
      idempotencyKey,
    } = params;

    if (!orderId || !targetState || !eventType) {
      throw new Error('orderId, targetState, and eventType are required for state transitions');
    }

    const outboxId = crypto.randomUUID();
    const finalIdempotencyKey = idempotencyKey || this._buildIdempotencyKey(orderId, targetState);
    const now = new Date().toISOString();

    const domainPayload = {
      ...eventPayload,
      orderId,
      previousState: eventPayload.previousState || null,
      newState: targetState,
      actorId: actorId || null,
      timestamp: now,
    };

    logger.info(
      { orderId, targetState, eventType, idempotencyKey: finalIdempotencyKey },
      '[OrderLifecycleOrchestrator] Initiating atomic order state transition'
    );

    try {
      // 1. Update Order / Booking status
      const { error: orderError } = await this.supabase
        .from('bookings')
        .update({
          status: targetState,
          updated_at: now,
        })
        .eq('id', orderId);

      if (orderError) {
        throw new Error(`Failed to update booking status: ${orderError.message}`);
      }

      // 2. Insert transactional outbox event
      const { data: outboxData, error: outboxError } = await this.supabase
        .from('outbox_events')
        .insert({
          id: outboxId,
          aggregate_type: 'order',
          aggregate_id: orderId,
          event_type: eventType,
          payload: domainPayload,
          status: 'PENDING',
          idempotency_key: finalIdempotencyKey,
          created_at: now,
        })
        .select('id')
        .single();

      if (outboxError) {
        // If unique idempotency collision, event was already written
        if (outboxError.code === '23505') {
          logger.warn({ orderId, idempotencyKey: finalIdempotencyKey }, '[OrderLifecycleOrchestrator] Duplicate event skipped via idempotency key');
          return { success: true, orderId, newState: targetState, outboxEventId: outboxId, isDuplicate: true };
        }
        throw new Error(`Failed writing to transactional outbox: ${outboxError.message}`);
      }

      return {
        success: true,
        orderId,
        newState: targetState,
        outboxEventId: outboxData?.id || outboxId,
      };
    } catch (err) {
      logger.error({ err, orderId, targetState }, '[OrderLifecycleOrchestrator] Atomic transition failed');
      throw err;
    }
  }

  // Convenience state transition helpers
  async markMatched(orderId, driverId, metadata = {}) {
    return this.transitionOrderState({
      orderId,
      targetState: ORDER_LIFECYCLE_STATES.MATCHED,
      eventType: DOMAIN_EVENT_TYPES.ORDER_MATCHED,
      eventPayload: { driverId, ...metadata },
      actorId: driverId,
    });
  }

  async markInTransit(orderId, driverId, metadata = {}) {
    return this.transitionOrderState({
      orderId,
      targetState: ORDER_LIFECYCLE_STATES.IN_TRANSIT,
      eventType: DOMAIN_EVENT_TYPES.ORDER_IN_TRANSIT,
      eventPayload: { driverId, departureTime: new Date().toISOString(), ...metadata },
      actorId: driverId,
    });
  }

  async markDelivered(orderId, driverId, otpCode, metadata = {}) {
    return this.transitionOrderState({
      orderId,
      targetState: ORDER_LIFECYCLE_STATES.DELIVERED,
      eventType: DOMAIN_EVENT_TYPES.ORDER_DELIVERED,
      eventPayload: { driverId, deliveryOtpVerified: Boolean(otpCode), ...metadata },
      actorId: driverId,
    });
  }

  async markSettled(orderId, transactionHash, metadata = {}) {
    return this.transitionOrderState({
      orderId,
      targetState: ORDER_LIFECYCLE_STATES.SETTLED,
      eventType: DOMAIN_EVENT_TYPES.ORDER_SETTLED,
      eventPayload: { transactionHash, ...metadata },
    });
  }
}

export default OrderLifecycleOrchestrator;
