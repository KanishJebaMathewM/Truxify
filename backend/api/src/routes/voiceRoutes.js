import express from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { processVoiceQuery, audioCache } from '../services/voiceService.js';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  AudioValidationError,
  validateAudioBuffer,
} from '../lib/audioValidation.js';
import { sanitizeUploadFilename } from '../lib/uploadFilename.js';
import logger from '../middleware/logger.js';

const router = express.Router();

const VOICE_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB file limit

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VOICE_MAX_FILE_SIZE },
  // First gate: reject on the declared type. Cheap, but client-supplied and
  // therefore advisory — the magic-byte check below is the authority.
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_AUDIO_MIME_TYPES.includes(file.mimetype));
  },
});

router.post('/query', authenticate, userLimiter, upload.single('file'), async (req, res) => {
  try {
    const bookingId = req.body?.bookingId || req.body?.booking_id;
    const textQuery = req.body?.text || req.body?.query;
    const file = req.file;

    if (!file && !textQuery) {
      return res.status(400).json({
        error: 'A valid audio file or text query is required.',
        hint: 'Provide an audio file upload or text/query field in form-data/JSON.',
      });
    }

    let audioBuffer = null;
    let safeFilename = 'voice-query.wav';

    if (file) {
      try {
        validateAudioBuffer(file.buffer);
      } catch (validationErr) {
        if (validationErr instanceof AudioValidationError) {
          logger.warn(
            { userId: req.user?.id, bookingId, declaredType: file.mimetype },
            `[voice] Rejected upload: ${validationErr.message}`
          );
          return res.status(400).json({ error: validationErr.message });
        }
        throw validationErr;
      }
      audioBuffer = file.buffer;
      safeFilename = sanitizeUploadFilename(file.originalname || 'voice-query.wav', 'voice-query.wav');
    }

    const result = await processVoiceQuery(req.user?.id, bookingId, audioBuffer, safeFilename, textQuery);
    
    // Prefix the audio_url with host if relative path
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers?.host || 'localhost:3000';
    if (result.audio_url && result.audio_url.startsWith('/')) {
      const baseUrl = process.env.PUBLIC_BASE_URL || `${protocol}://${host}`;
      result.audio_url = `${baseUrl}${result.audio_url}`;
    }
    
    res.json(result);
  } catch (err) {
    logger.error('Voice AI query failed:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error', stack: err.stack });
    logger.error({ requestId: req.requestId, query: req.body?.query }, 'Voice AI query failed:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

router.get('/audio/:id', authenticate, userLimiter, (req, res) => {
  const entry = audioCache.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'Audio not found' });
  }

  if (!entry.userId || (entry.userId !== req.user.id && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Access Denied: You do not have permission to access this audio.' });
  }

  res.set('Content-Type', 'audio/mpeg');
  res.send(entry.buffer);
});

export default router;
