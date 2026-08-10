import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { verificationService } from '../core/container.js';
import { supabase, supabaseAdmin } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import logger from '../middleware/logger.js';
import { verifyOrderParamsSchema, documentCheckSchema } from '../validation/requestSchemas.js';
import { scanDocument, MalwareScanError } from '../lib/malwareScanner.js';
import { PolicyError, policy } from '../security/policyEngine.js';
import digilockerService from '../services/digilockerService.js';
import { validateDocumentBuffer, DocumentValidationError } from '../lib/documentValidation.js';

const router = express.Router();
const orderVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('rl:order-verification:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

const documentCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('rl:document-check:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

const digilockerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('rl:digilocker:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

const kycUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('rl:kyc-upload:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

router.get('/order/:orderId', orderVerificationLimiter, authenticate, validateParams(verifyOrderParamsSchema), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, customer_id, driver_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to verify order access',
      });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    policy.authorize(req.user, 'order:view', { order });

    const result = await verificationService.verifyOrder(orderId);

    if (result.error && !result.orderId) {
      return res.status(404).json({
        success: false,
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error instanceof PolicyError) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/documents/check', documentCheckLimiter, authenticate, validateBody(documentCheckSchema), async (req, res) => {
  try {
    const { driverId } = req.body;

    // IDOR guard: a caller may only inspect their own document/KYC status
    // unless they hold an admin role (mirrors the ownership check used on the
    // order-scoped verification routes).
    try {
      policy.authorize(req.user, 'document:view', { driverId });
    } catch (error) {
      if (error instanceof PolicyError) {
        return res.status(error.status).json({
          success: false,
          error: error.message,
        });
      }
      throw error;
    }

    const result = await verificationService.checkDocumentIntegrity(driverId);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/digilocker/token', digilockerLimiter, authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Code is required' });
    }
    const tokenResult = await digilockerService.exchangeCode(code);
    res.status(200).json({
      success: true,
      data: tokenResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/digilocker/verify', digilockerLimiter, authenticate, async (req, res) => {
  try {
    const { accessToken, userId: bodyUserId } = req.body;
    const userId = req.user?.id || bodyUserId;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Access token is required' });
    }
    const verificationResult = await digilockerService.verifyDocuments(userId, accessToken);
    res.status(200).json({
      success: true,
      data: verificationResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const KYC_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const KYC_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: KYC_MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (KYC_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

router.post('/kyc/upload', kycUploadLimiter, upload.single('image'), authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    // Validate magic bytes and malware-scan before the buffer is forwarded to
    // the ML endpoint (same hardening as the PoD upload at orderRoutes).
    try {
      validateDocumentBuffer(req.file.buffer, req.file.mimetype);
      const scanResult = await scanDocument(req.file.buffer, req.file.originalname);
      if (!scanResult.clean) {
        return res.status(422).json({ success: false, error: 'Uploaded image failed malware scanning.' });
      }
    } catch (error) {
      if (error instanceof DocumentValidationError) {
        return res.status(422).json({ success: false, error: error.message });
      }
      if (error instanceof MalwareScanError) {
        return res.status(422).json({ success: false, error: error.message });
      }
      throw error;
    }

    // Set status to pending
    const { error: updateError } = await supabaseAdmin
      .from('driver_details')
      .update({ kyc_status: 'Pending KYC' })
      .eq('user_id', userId);

    if (updateError) {
      logger.warn({ updateError }, 'Failed to set pending status, but continuing with OCR');
    }

    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    formData.append('file', blob, req.file.originalname);

    const mlBaseUrl = (process.env.ML_API_URL || process.env.ML_ENGINE_URL || process.env.ML_SERVICE_URL || '').replace(/\/$/, '');
    const mlApiKey = process.env.ML_API_KEY;

    if (!mlBaseUrl || !mlApiKey) {
      logger.error('[OCR] ML service URL (ML_API_URL) or API key (ML_API_KEY) not configured');
      return res.status(503).json({ success: false, error: 'KYC OCR service is unconfigured' });
    }

    const mlResponse = await fetch(`${mlBaseUrl}/verify/kyc`, {
      method: 'POST',
      body: formData,
      headers: {
        'X-API-Key': mlApiKey,
      },
    });

    if (!mlResponse.ok) {
      const text = await mlResponse.text();
      return res.status(500).json({ success: false, error: 'OCR verification failed: ' + text });
    }

    const ocrData = await mlResponse.json();

    if (ocrData.verified) {
      const { error: verifyError } = await supabaseAdmin
        .from('driver_details')
        .update({ 
          kyc_status: 'Verified',
          kyc_doc_number: ocrData.extracted_number
        })
        .eq('user_id', userId);

      if (verifyError) throw verifyError;
    } else {
       const { error: rejectError } = await supabaseAdmin
        .from('driver_details')
        .update({ kyc_status: 'Rejected' })
        .eq('user_id', userId);

      if (rejectError) throw rejectError;
    }

    res.status(200).json({
      success: true,
      data: ocrData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
