import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { verificationService } from '../core/container.js';
import { supabase, supabaseAdmin, createUserClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import logger from '../middleware/logger.js';
import { verifyOrderParamsSchema, documentCheckSchema } from '../validation/requestSchemas.js';
import { scanDocument, MalwareScanError } from '../lib/malwareScanner.js';
import { PolicyError, policy } from '../security/policyEngine.js';
import digilockerService from '../services/digilockerService.js';
import { validateDocumentBuffer, DocumentValidationError } from '../lib/documentValidation.js';
import zkpService from '../services/zkp/zkp.service.js';

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
    const { data: order, error: orderError } = await supabaseAdmin
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
    logger.error({ event: 'VERIFICATION_UPLOAD_ERROR', requestId: req.requestId || req.id, error: error && error.message }, 'Verification upload error');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/documents/check', documentCheckLimiter, authenticate, validateBody(documentCheckSchema), async (req, res) => {
  try {
    const { driverId } = req.body;

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
    const authenticatedUserId = req.user?.id;

    if (!authenticatedUserId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Fixed #10259: Prevent IDOR / privilege escalation by rejecting bodyUserId mismatches 
    // instead of falling back to client-supplied user identifiers.
    if (bodyUserId && bodyUserId !== authenticatedUserId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Cannot verify documents for another user identity.',
      });
    }

    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Access token is required' });
    }

    const verificationResult = await digilockerService.verifyDocuments(authenticatedUserId, accessToken);
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
const OCR_HTTP_TIMEOUT_MS = 15000;

function normalizeKycDocNumber(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{4,30}$/.test(cleaned)) return null;
  return cleaned;
}

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

// Fixed #10258: `authenticate` runs BEFORE `upload.single('image')` to prevent unauthenticated memory-exhaustion DoS
router.post('/kyc/upload', kycUploadLimiter, authenticate, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    try {
      validateDocumentBuffer(req.file.buffer, req.file.mimetype);
      const scanResult = await scanDocument(req.file.buffer, req.file.originalname);
      if (!scanResult.clean) {
        return res.status(422).json({ success: false, error: 'Uploaded image failed malware scanning.' });
      }
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, '[verificationRoutes] KYC upload validation/malware scan error');
      if (error instanceof DocumentValidationError) {
        return res.status(422).json({ success: false, error: error.message });
      }
      if (error instanceof MalwareScanError) {
        return res.status(422).json({ success: false, error: error.message });
      }
      throw error;
    }

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

    const mlBaseUrl = (process.env.ML_API_URL || process.env.ML_ENGINE_URL || process.env.ML_SERVICE_URL || '').replace(/\/$/, '').trim();
    const mlApiKey = (process.env.ML_API_KEY || '').trim();

    if (!mlBaseUrl || !mlApiKey) {
      logger.error({ event: 'OCR_SERVICE_NOT_CONFIGURED', ip: req.ip }, '[OCR] ML service URL (ML_API_URL) or API key (ML_API_KEY) not configured');
      return res.status(503).json({ success: false, error: 'KYC OCR service is unconfigured' });
    }

    const mlResponse = await fetch(`${mlBaseUrl}/verify/kyc`, {
      method: 'POST',
      body: formData,
      headers: {
        'X-API-Key': mlApiKey,
      },
      signal: AbortSignal.timeout(OCR_HTTP_TIMEOUT_MS),
    });

    if (!mlResponse.ok) {
      const text = await mlResponse.text();
      return res.status(500).json({ success: false, error: 'OCR verification failed: ' + text });
    }

    const ocrData = await mlResponse.json();

    const governmentAttested =
      ocrData && ocrData.attested === true && ocrData.verified === true;

    if (governmentAttested) {
      const docNumber = normalizeKycDocNumber(ocrData.extracted_number);
      const { error: verifyError } = await supabaseAdmin
        .from('driver_details')
        .update({
          kyc_status: 'Verified',
          kyc_doc_number: docNumber,
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
    if (error?.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'OCR service timed out. Please try again.' });
    }
    logger.error({ event: 'KYC_UPLOAD_ERROR', requestId: req.requestId || req.id, userId: req.user?.id, error: error?.message || error, stack: error?.stack }, 'KYC upload error');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const zkVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('rl:zk-verify:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

/**
 * POST /api/verification/zk-verify-credential
 * Verifies Groth16 ZKP driver credentials, ensures unexpired timestamp & unspent nullifier,
 * and issues a signed session authorization token for bidding.
 */
router.post('/zk-verify-credential', zkVerifyLimiter, authenticate, async (req, res) => {
  try {
    const { proof, publicSignals } = req.body || {};
    const userId = req.user?.id;

    if (!proof || !publicSignals) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: proof and publicSignals must be provided',
      });
    }

    const result = await zkpService.verifyCredentialProof({
      proof,
      publicSignals,
      userId,
    });

    if (!result.success) {
      const statusCode = result.code === 'NULLIFIER_ALREADY_SPENT' ? 409 : 400;
      return res.status(statusCode).json({
        success: false,
        code: result.code,
        error: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      verified: true,
      token: result.sessionToken,
      expiresAt: result.expiresAt,
      nullifierHash: result.nullifierHash,
    });
  } catch (error) {
    logger.error({ err: error, userId: req.user?.id }, '[ZKP] Error in zk-verify-credential route');
    return res.status(500).json({
      success: false,
      error: 'Internal server error during credential verification',
    });
  }
});

export default router;
