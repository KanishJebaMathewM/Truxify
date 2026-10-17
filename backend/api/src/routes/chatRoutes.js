/**
 * @fileoverview REST endpoints for chat history, image uploads, and admin moderation.
 * Real-time messaging is handled via WebSocket in tracker.js.
 */

import express from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getChatHistory, adminDeleteMessage, verifyChatAccess } from '../services/chatService.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

/**
 * GET /api/chat/:orderId/history
 * Fetches paginated chat history for an order.
 */
router.get('/:orderId/history', authenticate, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { limit = 50, before } = req.query;

        const access = await verifyChatAccess(orderId, req.user.id);
        if (!access.authorized && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized to view this chat' });
        }

        const messages = await getChatHistory(orderId, parseInt(limit, 10), before);

        res.json({
            success: true,
            messages,
            hasMore: messages.length === parseInt(limit, 10)
        });
    } catch (err) {
        logger.error({ err }, 'GET /chat/:orderId/history error');
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

/**
 * POST /api/chat/:orderId/image
 * Uploads a chat image to Supabase Storage and returns the URL.
 */
router.post('/:orderId/image', authenticate, upload.single('image'), async (req, res) => {
    try {
        const { orderId } = req.params;

        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const access = await verifyChatAccess(orderId, req.user.id);
        if (!access.authorized) {
            return res.status(403).json({ error: 'Not authorized to upload to this chat' });
        }

        const ext = req.file.originalname.split('.').pop() || 'jpg';
        const filePath = `chat/${orderId}/${req.user.id}_${Date.now()}.${ext}`;

        const { data, error } = await supabaseAdmin.storage
            .from('driver-documents') // Reusing existing private bucket
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                cacheControl: '3600',
                upsert: false
            });

        if (error) throw error;

        // Generate a signed URL valid for 7 days
        const { data: urlData } = await supabaseAdmin.storage
            .from('driver-documents')
            .createSignedUrl(filePath, 60 * 60 * 24 * 7);

        res.json({
            success: true,
            imageUrl: urlData.signedUrl,
            storagePath: filePath
        });
    } catch (err) {
        logger.error({ err }, 'POST /chat/:orderId/image error');
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

/**
 * POST /api/chat/messages/:messageId/read
 * Marks messages as read (fallback for WS failure).
 */
router.post('/messages/:messageId/read', authenticate, async (req, res) => {
    try {
        const { messageId } = req.params;

        await supabaseAdmin
            .from('chat_messages')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('id', messageId);

        res.json({ success: true });
    } catch (err) {
        logger.error({ err }, 'POST /chat/messages/:messageId/read error');
        res.status(500).json({ error: 'Failed to mark as read' });
    }
});

/**
 * DELETE /api/chat/admin/messages/:messageId
 * Admin moderation: soft deletes a message.
 */
router.delete('/admin/messages/:messageId', authenticate, requireRole(['admin']), async (req, res) => {
    try {
        const { messageId } = req.params;
        const { reason = 'Violation of community guidelines' } = req.body;

        await adminDeleteMessage(messageId, req.user.id, reason);

        res.json({ success: true, message: 'Message deleted' });
    } catch (err) {
        logger.error({ err }, 'DELETE /chat/admin/messages/:messageId error');
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

export default router;
