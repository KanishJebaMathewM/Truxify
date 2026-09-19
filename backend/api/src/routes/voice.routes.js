import express from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import voiceAiService from '../services/voice/VoiceAiService.js';
import logger from '../middleware/logger.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const VALID_LANGUAGES = ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml'];

const router = express.Router();
const upload = multer({
  dest: 'uploads/voice/', // Temporary storage for incoming audio
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio is allowed.'));
    }
  }
});
/**
 * @openapi
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     VoiceAssistantError:
 *       type: object
 *       required: [error]
 *       properties:
 *         error:
 *           type: string
 *           example: Audio file is required
 * /api/v1/voice/assistant:
 *   post:
 *     tags: [Voice]
 *     summary: Interact with the Voice AI Assistant
 *     description: Accepts an audio file, transcribes it, queries the LLM, and returns synthesized TTS audio.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [audio]
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Audio recording to transcribe. Only audio MIME types are accepted and uploads are limited to 10 MiB.
 *               language:
 *                 type: string
 *                 enum: [en, hi, bn, ta, te, mr, gu, kn, ml]
 *                 default: en
 *                 description: Language used for transcription and assistant processing.
 *     responses:
 *       200:
 *         description: Synthesized assistant response audio stream.
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Audio file is missing or the requested language is unsupported.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VoiceAssistantError'
 *       401:
 *         description: Authentication is required.
 *       413:
 *         description: Uploaded audio exceeds the 10 MiB limit.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Voice query processing failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VoiceAssistantError'
 */

router.post('/assistant', authenticate, userLimiter, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const language = req.body.language || 'en';
    if (typeof language !== 'string' || !VALID_LANGUAGES.includes(language)) {
      await unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Unsupported language. Supported: ' + VALID_LANGUAGES.join(', ') });
    }

    const audioFilePath = req.file.path;

    logger.info(`Received voice query from user ${req.user?.id} in ${language}`);

    const audioStream = await voiceAiService.processVoiceQuery(audioFilePath, language);

    // Set headers to stream audio back to the client
    res.set({
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked'
    });

    // Pipe the ElevenLabs stream directly to the Express response
    audioStream.pipe(res);

    audioStream.on('error', async (err) => {
      logger.error('Error streaming audio back to client:', err);
      res.end();
      await unlink(audioFilePath).catch(() => {});
    });

  } catch (error) {
    logger.error('Voice Assistant Endpoint Error:', error);
    if (req.file) {
      await unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to process voice query' });
  }
});

export default router;
