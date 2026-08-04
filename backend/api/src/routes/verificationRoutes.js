import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { verificationService } from '../core/container.js';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import { verifyOrderParamsSchema, documentCheckSchema } from '../validation/requestSchemas.js';
import { PolicyError, policy } from '../security/policyEngine.js';
import digilockerService from '../services/verification/DigilockerService.js';

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

const upload = multer({ storage: multer.memoryStorage() });

router.post('/kyc/upload', upload.single('image'), authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    // Set status to pending
    const { error: updateError } = await supabase
      .from('driver_details')
      .update({ kyc_status: 'Pending KYC' })
      .eq('driver_id', userId);

    if (updateError) {
      console.warn("Failed to set pending status, but continuing with OCR", updateError);
    }

    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    formData.append('file', blob, req.file.originalname);

    const mlResponse = await fetch('http://127.0.0.1:8000/verify/kyc', {
      method: 'POST',
      body: formData,
      headers: {
        'X-API-Key': process.env.ML_API_KEY || 'truxify_ml_dev_key',
      },
    });

    if (!mlResponse.ok) {
      const text = await mlResponse.text();
      return res.status(500).json({ success: false, error: 'OCR verification failed: ' + text });
    }

    const ocrData = await mlResponse.json();

    if (ocrData.verified) {
      const { error: verifyError } = await supabase
        .from('driver_details')
        .update({ 
          kyc_status: 'Verified',
          kyc_doc_number: ocrData.extracted_number
        })
        .eq('driver_id', userId);

      if (verifyError) throw verifyError;
    } else {
       const { error: rejectError } = await supabase
        .from('driver_details')
        .update({ kyc_status: 'Rejected' })
        .eq('driver_id', userId);

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
