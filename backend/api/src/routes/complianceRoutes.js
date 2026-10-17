/**
 * @fileoverview Compliance document management endpoints.
 */

import express from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
    processDocumentUpload,
    adminVerifyDocument,
    getDriverDocuments
} from '../services/documentVerificationService.js';
import { checkDriverCompliance } from '../lib/expiryTracker.js';
import { DOCUMENT_RULES } from '../lib/documentValidator.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * GET /api/compliance/documents
 * Returns all documents for the authenticated driver.
 */
router.get('/documents', authenticate, requireRole(['driver']), async (req, res) => {
    try {
        const result = await getDriverDocuments(req.user.id);
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error({ err }, 'GET /compliance/documents error');
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

/**
 * GET /api/compliance/status
 * Returns compliance status (for load acceptance gating).
 */
router.get('/status', authenticate, requireRole(['driver']), async (req, res) => {
    try {
        const compliance = await checkDriverCompliance(req.user.id);
        res.json({ success: true, ...compliance });
    } catch (err) {
        logger.error({ err }, 'GET /compliance/status error');
        res.status(500).json({ error: 'Failed to check compliance' });
    }
});

/**
 * POST /api/compliance/documents/upload
 * Uploads and verifies a compliance document.
 */
router.post('/documents/upload', authenticate, requireRole(['driver']), upload.single('document'), async (req, res) => {
    try {
        const { docType } = req.body;

        if (!docType || !DOCUMENT_RULES[docType]) {
            return res.status(400).json({ error: `Invalid document type. Allowed: ${Object.keys(DOCUMENT_RULES).join(', ')}` });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No document file provided' });
        }

        // Upload to storage first
        const ext = req.file.originalname.split('.').pop() || 'jpg';
        const storagePath = `compliance/${req.user.id}/${docType}_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from('driver-documents')
            .upload(storagePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            });

        if (uploadError) {
            logger.error({ err: uploadError }, 'Storage upload failed');
            return res.status(500).json({ error: 'Failed to upload file to storage' });
        }

        // Process and verify
        const result = await processDocumentUpload({
            driverId: req.user.id,
            docType,
            file: req.file,
            storagePath
        });

        res.json({ success: result.success, ...result });
    } catch (err) {
        logger.error({ err }, 'POST /compliance/documents/upload error');
        res.status(500).json({ error: 'Document processing failed' });
    }
});

/**
 * GET /api/compliance/admin/pending
 * Admin: Get documents pending review.
 */
router.get('/admin/pending', authenticate, requireRole(['admin', 'compliance']), async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('driver_documents')
            .select(`
        id,
        driver_id,
        document_type,
        document_number,
        ocr_confidence,
        extracted_data,
        status,
        rejection_reason,
        created_at,
        driver:profiles(full_name, phone)
      `)
            .eq('status', 'pending_review')
            .order('created_at', { ascending: true })
            .limit(100);

        if (error) throw error;

        res.json({ success: true, documents: data || [] });
    } catch (err) {
        logger.error({ err }, 'GET /compliance/admin/pending error');
        res.status(500).json({ error: 'Failed to fetch pending documents' });
    }
});

/**
 * POST /api/compliance/admin/documents/:id/verify
 * Admin: Manually verify a document (override OCR).
 */
router.post('/admin/documents/:id/verify', authenticate, requireRole(['admin', 'compliance']), async (req, res) => {
    try {
        const { id } = req.params;
        const { notes = '' } = req.body;

        await adminVerifyDocument(id, req.user.id, notes);

        res.json({ success: true, message: 'Document verified' });
    } catch (err) {
        logger.error({ err }, 'POST /compliance/admin/documents/:id/verify error');
        res.status(500).json({ error: 'Failed to verify document' });
    }
});

/**
 * POST /api/compliance/admin/documents/:id/reject
 * Admin: Reject a document.
 */
router.post('/admin/documents/:id/reject', authenticate, requireRole(['admin', 'compliance']), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }

        const { error } = await supabaseAdmin
            .from('driver_documents')
            .update({
                status: 'rejected',
                rejection_reason: reason,
                rejected_by: req.user.id,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true, message: 'Document rejected' });
    } catch (err) {
        logger.error({ err }, 'POST /compliance/admin/documents/:id/reject error');
        res.status(500).json({ error: 'Failed to reject document' });
    }
});

/**
 * GET /api/compliance/rules
 * Returns document validation rules (for frontend forms).
 */
router.get('/rules', (req, res) => {
    const rules = {};
    for (const [type, rule] of Object.entries(DOCUMENT_RULES)) {
        rules[type] = {
            name: rule.name,
            numberPattern: rule.numberRegex.source,
            requiredFields: rule.requiredFields
        };
    }
    res.json({ success: true, rules });
});

export default router;
