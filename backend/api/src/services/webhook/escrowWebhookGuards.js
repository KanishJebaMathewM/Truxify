/**
 * Escrow Webhook Guards and Processing Logic
 * 
 * Handles incoming escrow webhook events, validates payloads,
 * and updates order states in the database.
 */
import logger from '../../middleware/logger.js';
import { supabaseAdmin } from '../../config/db.js';

/**
 * Processes an incoming escrow webhook event.
 * 
 * @param {string} eventType - The type of escrow event (e.g., 'PaymentReleased').
 * @param {Object} payload - The webhook payload.
 * @returns {Promise<Object>} A receipt of processing.
 */
export async function processEscrowWebhookEvent(eventType, payload = {}) {
    if (!eventType || eventType.trim() === '') {
        throw new Error('Missing escrow webhook event type');
    }

    // Payload validation now runs FIRST, before any legacy simulation branches.
    // This ensures that missing critical fields like orderId are caught immediately.
    if (!payload || !payload.orderId) {
        throw new Error('Missing orderId in escrow webhook payload');
    }

    if (eventType === 'PaymentReleased') {
        const { orderId, txHash } = payload;

        const { data: order, error } = await supabaseAdmin
            .from('orders')
            .select('id, order_display_id, driver_id, escrow_status, release_tx_hash, refund_tx_hash')
            .eq('order_display_id', orderId)
            .maybeSingle();

        if (error) {
            logger.error({ error, orderId }, 'Failed to load order for escrow webhook');
            throw new Error('Failed to load order');
        }

        if (!order) {
            logger.warn({ orderId }, 'No order found for escrow webhook');
            throw new Error('No order found');
        }

        // Idempotency check: if already released, acknowledge without state change
        if (order.escrow_status === 'released') {
            logger.info({ orderId, status: order.escrow_status }, 'Order already released, idempotent ack');
            return { received: true, status: 'already_released' };
        }

        // Update order status to released (supports release without txHash as per current contract)
        const updatePayload = {
            escrow_status: 'released',
            release_tx_hash: txHash || order.release_tx_hash,
            updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabaseAdmin
            .from('orders')
            .update(updatePayload)
            .eq('id', order.id);

        if (updateError) {
            logger.error({ updateError, orderId }, 'Failed to update order escrow status');
            throw new Error('Failed to update order status');
        }

        logger.info({ orderId, txHash }, 'Order marked as released via escrow webhook');
        return { received: true, status: 'released' };
    }

    // Acknowledge unknown event types without state change
    logger.warn({ eventType, orderId: payload.orderId }, 'Unknown escrow webhook event type');
    return { received: true, status: 'unknown_event' };
}
