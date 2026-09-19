/**
 * @fileoverview Core chat service handling message persistence, rate limiting,
 * and thread management for driver-customer communication.
 */

import { supabaseAdmin, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { encryptMessage, decryptMessage } from '../lib/chatEncryption.js';
import { enqueueOfflineMessage } from '../lib/messageQueue.js';

const CHAT_RATE_LIMIT_PREFIX = 'chat:rate:';
const RATE_LIMIT_WINDOW_SEC = 60;
const MAX_MESSAGES_PER_WINDOW = 60;
const ENCRYPTION_SECRET = process.env.CHAT_ENCRYPTION_SECRET || 'truxify-default-chat-secret-change-me';

/**
 * Checks if a user has exceeded the chat rate limit.
 * @param {string} userId 
 * @returns {Promise<boolean>} True if rate limited.
 */
export async function isChatRateLimited(userId) {
    if (!redisClient || redisClient.status !== 'ready') return false;

    const key = `${CHAT_RATE_LIMIT_PREFIX}${userId}`;

    try {
        const current = await redisClient.incr(key);
        if (current === 1) {
            await redisClient.expire(key, RATE_LIMIT_WINDOW_SEC);
        }
        return current > MAX_MESSAGES_PER_WINDOW;
    } catch (err) {
        logger.error({ err, userId }, 'Chat rate limit check failed');
        return false; // Fail open to not block chat entirely on Redis failure
    }
}

/**
 * Saves a chat message to Supabase and returns the persisted record.
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.senderId
 * @param {string} params.senderRole
 * @param {string} params.type - 'text', 'image', 'location'
 * @param {string} params.content - Plaintext content or storage URL
 * @returns {Promise<object>} The saved message record.
 */
export async function saveChatMessage({ orderId, senderId, senderRole, type, content }) {
    if (!supabaseAdmin) throw new Error('Supabase not configured');

    const encryptedContent = type === 'text'
        ? encryptMessage(content, ENCRYPTION_SECRET)
        : content; // Images/locations are URLs/JSON, not encrypted the same way

    const { data, error } = await supabaseAdmin
        .from('chat_messages')
        .insert([{
            order_id: orderId,
            sender_id: senderId,
            sender_role: senderRole,
            message_type: type,
            encrypted_content: encryptedContent,
            is_read: false,
            created_at: new Date().toISOString()
        }])
        .select('id, order_id, sender_id, sender_role, message_type, is_read, created_at')
        .single();

    if (error) {
        logger.error({ err: error, orderId, senderId }, 'Failed to save chat message');
        throw new Error('Database error saving message');
    }

    // Return with decrypted content for immediate broadcast
    return {
        ...data,
        content: type === 'text' ? content : JSON.parse(content),
        timestamp: data.created_at
    };
}

/**
 * Fetches paginated chat history for an order.
 * @param {string} orderId 
 * @param {number} limit 
 * @param {string} before - ISO timestamp cursor
 * @returns {Promise<object[]>}
 */
export async function getChatHistory(orderId, limit = 50, before = null) {
    if (!supabaseAdmin) throw new Error('Supabase not configured');

    let query = supabaseAdmin
        .from('chat_messages')
        .select('id, order_id, sender_id, sender_role, message_type, encrypted_content, is_read, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (before) {
        query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
        logger.error({ err: error, orderId }, 'Failed to fetch chat history');
        throw new Error('Database error fetching history');
    }

    return (data || []).map(msg => ({
        id: msg.id,
        orderId: msg.order_id,
        senderId: msg.sender_id,
        senderRole: msg.sender_role,
        type: msg.message_type,
        content: msg.message_type === 'text'
            ? decryptMessage(msg.encrypted_content, ENCRYPTION_SECRET)
            : JSON.parse(msg.encrypted_content),
        isRead: msg.is_read,
        timestamp: msg.created_at
    })).reverse(); // Return chronological order
}

/**
 * Marks messages in a thread as read by a specific user.
 * @param {string} orderId 
 * @param {string} userId 
 */
export async function markMessagesAsRead(orderId, userId) {
    if (!supabaseAdmin) return;

    try {
        await supabaseAdmin
            .from('chat_messages')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('order_id', orderId)
            .neq('sender_id', userId)
            .eq('is_read', false);
    } catch (err) {
        logger.error({ err, orderId, userId }, 'Failed to mark messages as read');
    }
}

/**
 * Verifies that a user is part of the order (driver or customer).
 * @param {string} orderId 
 * @param {string} userId 
 * @returns {Promise<{authorized: boolean, role: string|null}>}
 */
export async function verifyChatAccess(orderId, userId) {
    if (!supabaseAdmin) return { authorized: false, role: null };

    const { data: order, error } = await supabaseAdmin
        .from('orders')
        .select('driver_id, customer_id')
        .eq('id', orderId)
        .maybeSingle();

    if (error || !order) return { authorized: false, role: null };

    if (order.driver_id === userId) return { authorized: true, role: 'driver' };
    if (order.customer_id === userId) return { authorized: true, role: 'customer' };

    return { authorized: false, role: null };
}

/**
 * Admin function to delete a specific message (moderation).
 * @param {string} messageId 
 * @param {string} adminId 
 * @param {string} reason 
 */
export async function adminDeleteMessage(messageId, adminId, reason) {
    if (!supabaseAdmin) throw new Error('Supabase not configured');

    // Soft delete for audit trail
    const { error } = await supabaseAdmin
        .from('chat_messages')
        .update({
            is_deleted: true,
            deleted_by: adminId,
            deleted_reason: reason,
            deleted_at: new Date().toISOString()
        })
        .eq('id', messageId);

    if (error) {
        logger.error({ err: error, messageId }, 'Admin failed to delete chat message');
        throw new Error('Failed to delete message');
    }
}
