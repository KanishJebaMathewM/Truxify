// backend/api/src/routes/verificationRoutes.js

// Trim each environment candidate individually before fallback evaluation
const mlBaseUrl = (
  process.env.ML_API_URL?.trim() ||
  process.env.ML_ENGINE_URL?.trim() ||
  process.env.ML_SERVICE_URL?.trim() ||
  process.env.ML_OCR_SERVICE_URL?.trim() ||
  ''
).replace(/\/+$/, '');

const mlApiKey = (
  process.env.ML_API_KEY?.trim() ||
  process.env.ML_OCR_API_KEY?.trim() ||
  ''
);

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
      if (error instanceof DocumentValidationError || error instanceof MalwareScanError) {
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

    if (!mlBaseUrl || !mlApiKey) {
      logger.error({ event: 'OCR_SERVICE_NOT_CONFIGURED', ip: req.ip }, '[OCR] ML service URL or API key not configured');
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
