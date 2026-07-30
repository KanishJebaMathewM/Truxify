import express from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { processVoiceQuery, audioCache } from '../services/voiceService.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB file limit

router.post('/query', authenticate, userLimiter, upload.single('file'), async (req, res) => {
  try {
    const bookingId = req.body.bookingId || req.body.booking_id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Audio file is required.' });
    }

    if (!bookingId) {
      return res.status(400).json({ error: 'Booking ID is required.' });
    }

    const result = await processVoiceQuery(req.user.id, bookingId, file.buffer, file.originalname);
    
    // Prefix the audio_url with host if relative path
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    if (result.audio_url && result.audio_url.startsWith('/')) {
      result.audio_url = `${protocol}://${host}${result.audio_url}`;
    }
    
    res.json(result);
  } catch (err) {
    logger.error('Voice AI query failed:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

router.get('/audio/:id', authenticate, userLimiter, (req, res) => {
  const buffer = audioCache.get(req.params.id);
  if (!buffer) {
    return res.status(404).json({ error: 'Audio not found' });
  }
  res.set('Content-Type', 'audio/mpeg');
  res.send(buffer);
});

export default router;
