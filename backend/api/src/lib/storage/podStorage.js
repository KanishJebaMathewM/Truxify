/**
 * @fileoverview Proof of Delivery (PoD) Storage Helper
 * Resolves Issue #10277: POD uploads were using the shared anon-key client
 * which has no INSERT policy on the private driver-documents bucket.
 * 
 * This module:
 * 1. Uses the authenticated user's client (createUserClient) or service role
 * 2. Generates proper storage paths
 * 3. Creates signed URLs for customer/driver access
 * 4. Validates file types and sizes
 */

import { supabaseAdmin, createUserClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import crypto from 'crypto';
import path from 'path';

/**
 * PoD storage configuration
 */
export const POD_CONFIG = {
    BUCKET_NAME: 'driver-documents',
    SIGNATURE_MAX_BYTES: 2 * 1024 * 1024, // 2MB
    PHOTO_MAX_BYTES: 5 * 1024 * 1024,     // 5MB
    ALLOWED_MIME_TYPES: [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'application/pdf'
    ],
    SIGNED_URL_TTL_SECONDS: 60 * 60 * 24 * 7, // 7 days
    FILENAME_PREFIX: {
        SIGNATURE: 'pod_sig',
        PHOTO: 'pod_photo'
    }
};

/**
 * Validates a file for PoD upload.
 * 
 * @param {object} file - Multer file object { buffer, mimetype, size, originalname }
 * @param {'signature'|'photo'} type - Type of PoD file
 * @returns {{valid: boolean, error?: string}}
 */
export function validatePodFile(file, type = 'signature') {
    if (!file || !file.buffer) {
        return { valid: false, error: 'No file provided' };
    }

    // Check MIME type
    if (!POD_CONFIG.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return {
            valid: false,
            error: `Invalid file type: ${file.mimetype}. Allowed: ${POD_CONFIG.ALLOWED_MIME_TYPES.join(', ')}`
        };
    }

    // Check size
    const maxSize = type === 'signature'
        ? POD_CONFIG.SIGNATURE_MAX_BYTES
        : POD_CONFIG.PHOTO_MAX_BYTES;

    if (file.size > maxSize) {
        return {
            valid: false,
            error: `File too large. Max ${Math.floor(maxSize / 1024 / 1024)}MB for ${type}`
        };
    }

    if (file.size === 0) {
        return { valid: false, error: 'File is empty' };
    }

    return { valid: true };
}

/**
 * Generates a secure, unique storage path for a PoD file.
 * Format: {userId}/pod_{type}_{orderId}_{timestamp}_{random}.{ext}
 * 
 * @param {string} userId - The driver's user ID (from profiles.id)
 * @param {string} orderId - The order UUID
 * @param {'signature'|'photo'} type - Type of PoD
 * @param {string} originalName - Original filename (for extension)
 * @returns {string} Storage path
 */
export function generatePodStoragePath(userId, orderId, type, originalName = '') {
    if (!userId || !orderId || !type) {
        throw new Error('userId, orderId, and type are required');
    }

    const prefix = POD_CONFIG.FILENAME_PREFIX[type] || 'pod';
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(4).toString('hex');

    // Extract extension safely
    let ext = 'jpg';
    if (originalName) {
        const parsedExt = path.extname(originalName).toLowerCase().replace('.', '');
        if (['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(parsedExt)) {
            ext = parsedExt === 'jpeg' ? 'jpg' : parsedExt;
        }
    }

    // Sanitize userId and orderId for path safety
    const safeUserId = userId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const safeOrderId = orderId.replace(/[^a-zA-Z0-9\-_]/g, '');

    return `${safeUserId}/${prefix}_${safeOrderId}_${timestamp}_${randomSuffix}.${ext}`;
}

/**
 * Uploads a PoD file to Supabase Storage using the appropriate client.
 * Uses createUserClient(req.token) if available, falls back to supabaseAdmin.
 * 
 * @param {object} params - Upload parameters
 * @param {Buffer} params.fileBuffer - The file contents
 * @param {string} params.storagePath - Target path in bucket
 * @param {string} params.mimeType - MIME type of file
 * @param {string} params.userToken - JWT token of authenticated user (optional)
 * @param {string} params.upsert - Whether to upsert (default: false)
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
export async function uploadPodFile(params) {
    const {
        fileBuffer,
        storagePath,
        mimeType,
        userToken = null,
        upsert = false
    } = params;

    if (!fileBuffer || !storagePath || !mimeType) {
        return { success: false, error: 'Missing required upload parameters' };
    }

    // Determine which client to use
    // Priority: 1. User client (if token provided) 2. Admin client
    let client;
    let clientType;

    if (userToken && typeof createUserClient === 'function') {
        try {
            client = createUserClient(userToken);
            clientType = 'authenticated';
        } catch (err) {
            logger.warn({ err }, 'Failed to create user client, falling back to admin');
            client = supabaseAdmin;
            clientType = 'service_role';
        }
    } else {
        client = supabaseAdmin;
        clientType = 'service_role';
    }

    if (!client) {
        return { success: false, error: 'No Supabase client available' };
    }

    try {
        const { data, error } = await client.storage
            .from(POD_CONFIG.BUCKET_NAME)
            .upload(storagePath, fileBuffer, {
                contentType: mimeType,
                upsert,
                cacheControl: '3600'
            });

        if (error) {
            logger.error({
                err: error,
                storagePath,
                clientType
            }, 'PoD upload failed');
            return {
                success: false,
                error: error.message || 'Upload failed',
                code: error.statusCode || error.code
            };
        }

        logger.info({
            storagePath,
            clientType,
            size: fileBuffer.length
        }, 'PoD file uploaded successfully');

        return {
            success: true,
            path: data?.path || storagePath,
            clientType
        };
    } catch (err) {
        logger.error({ err, storagePath }, 'Unexpected error during PoD upload');
        return { success: false, error: err.message || 'Upload error' };
    }
}

/**
 * Creates a signed URL for accessing a private PoD file.
 * Signed URLs allow customers and drivers to view PoD images without public bucket access.
 * 
 * @param {string} storagePath - Path to the file in storage
 * @param {number} ttlSeconds - URL validity (default: 7 days)
 * @param {string} userToken - User token for authenticated client (optional)
 * @returns {Promise<{url?: string, error?: string}>}
 */
export async function createPodSignedUrl(storagePath, ttlSeconds = POD_CONFIG.SIGNED_URL_TTL_SECONDS, userToken = null) {
    if (!storagePath) {
        return { error: 'Storage path required' };
    }

    let client;
    if (userToken && typeof createUserClient === 'function') {
        try {
            client = createUserClient(userToken);
        } catch (err) {
            client = supabaseAdmin;
        }
    } else {
        client = supabaseAdmin;
    }

    if (!client) {
        return { error: 'No Supabase client available' };
    }

    try {
        const { data, error } = await client.storage
            .from(POD_CONFIG.BUCKET_NAME)
            .createSignedUrl(storagePath, ttlSeconds);

        if (error) {
            logger.error({ err: error, storagePath }, 'Failed to create signed URL');
            return { error: error.message || 'Signed URL generation failed' };
        }

        return { url: data?.signedUrl };
    } catch (err) {
        logger.error({ err, storagePath }, 'Error creating signed URL');
        return { error: err.message || 'Signed URL error' };
    }
}

/**
 * Verifies that the authenticated user has access to a PoD file.
 * - Drivers can access their own PoDs
 * - Customers can access PoDs for orders they placed
 * - Admins can access all
 * 
 * @param {object} user - Authenticated user { id, role }
 * @param {string} orderId - Order UUID
 * @param {object} orderRepository - Repository to fetch order details
 * @returns {Promise<{authorized: boolean, reason?: string}>}
 */
export async function verifyPodAccess(user, orderId, orderRepository) {
    if (!user || !orderId) {
        return { authorized: false, reason: 'Missing user or order' };
    }

    // Admins have universal access
    if (user.role === 'admin') {
        return { authorized: true };
    }

    try {
        const { data: order, error } = await orderRepository.findOrderById(orderId, 'id, driver_id, customer_id');

        if (error || !order) {
            return { authorized: false, reason: 'Order not found' };
        }

        // Driver can access their own orders
        if (user.role === 'driver' && order.driver_id === user.id) {
            return { authorized: true };
        }

        // Customer can access their own orders
        if (user.role === 'customer' && order.customer_id === user.id) {
            return { authorized: true };
        }

        return { authorized: false, reason: 'Not authorized for this order' };
    } catch (err) {
        logger.error({ err, orderId, userId: user.id }, 'Error verifying PoD access');
        return { authorized: false, reason: 'Access check failed' };
    }
}

/**
 * Deletes a PoD file from storage.
 * Used when an order is cancelled or PoD is rejected.
 * 
 * @param {string} storagePath - Path to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deletePodFile(storagePath) {
    if (!storagePath || !supabaseAdmin) {
        return { success: false, error: 'Cannot delete' };
    }

    try {
        const { error } = await supabaseAdmin.storage
            .from(POD_CONFIG.BUCKET_NAME)
            .remove([storagePath]);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Lists all PoD files for an order.
 * 
 * @param {string} userId - Driver's user ID
 * @param {string} orderId - Order UUID
 * @returns {Promise<{files: Array, error?: string}>}
 */
export async function listOrderPodFiles(userId, orderId) {
    if (!userId || !orderId || !supabaseAdmin) {
        return { files: [], error: 'Missing parameters' };
    }

    const safeUserId = userId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const safeOrderId = orderId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const prefix = `${safeUserId}/pod_`;

    try {
        const { data, error } = await supabaseAdmin.storage
            .from(POD_CONFIG.BUCKET_NAME)
            .list(safeUserId, {
                limit: 100,
                offset: 0,
                sortBy: { column: 'created_at', order: 'desc' }
            });

        if (error) {
            return { files: [], error: error.message };
        }

        // Filter to only PoD files for this order
        const podFiles = (data || []).filter(file =>
            file.name.includes(`_${safeOrderId}_`) &&
            (file.name.startsWith('pod_sig_') || file.name.startsWith('pod_photo_'))
        );

        return { files: podFiles };
    } catch (err) {
        return { files: [], error: err.message };
    }
}
