import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import axios from 'axios';
import logger from '../../middleware/logger.js';

class VoiceAiService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    
    // Voice IDs for different languages
    this.voiceIds = {
      en: 'EXAVITQu4vr4xnSDxMaL', // Example ElevenLabs Voice ID for English (e.g. Bella or Adam)
      hi: 'pNInz6obpgDQGcFmaJgB', // Example Voice ID (Adam is multilingual)
      ta: 'pNInz6obpgDQGcFmaJgB'  // Example Voice ID
    };
  }

  /**
   * Process a voice query end-to-end
   * @param {string} audioFilePath - Path to the uploaded audio file
   * @param {string} language - 'en', 'hi', or 'ta'
   * @returns {Promise<stream.Readable>} Audio stream from ElevenLabs
   */
  async processVoiceQuery(audioFilePath, languageParam = 'en') {
    // Validate and sanitize language to prevent Prompt Injection (CodeQL fix)
    const allowedLanguages = {
      'en': 'English',
      'hi': 'Hindi',
      'ta': 'Tamil'
    };
    const language = allowedLanguages[languageParam] ? languageParam : 'en';
    const languageName = allowedLanguages[language];

    // Secure the file path to prevent path traversal (CodeQL fix)
    const safeFileName = path.basename(audioFilePath);
    const safePath = path.resolve(process.cwd(), 'uploads', 'voice', safeFileName);

    if (safePath !== path.resolve(audioFilePath)) {
      throw new Error('Security Error: Invalid file path detected.');
    }

    try {
      // 1. Transcribe Audio using Whisper
      logger.info(`Starting transcription for language: ${languageName} (${language})`);
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(safePath),
        model: 'whisper-1',
        language: language,
      });
      
      const userText = transcription.text;
      logger.info(`Transcription result: ${userText}`);

      // 2. Generate LLM Response
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: `You are the Truxify Driver Voice Assistant. Answer logistics queries concisely in ${languageName}. Examples: "Where is my truck?", "When will I get paid?". Keep responses under 2 sentences.` 
          },
          { role: 'user', content: userText }
        ],
      });

      const llmResponseText = completion.choices[0].message.content;
      logger.info(`LLM Response: ${llmResponseText}`);

      // 3. Convert Text to Speech using ElevenLabs
      const voiceId = this.voiceIds[language] || this.voiceIds['en'];
      const ttsResponse = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
        {
          text: llmResponseText,
          model_id: 'eleven_multilingual_v2',
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': this.elevenLabsApiKey,
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
        }
      );

      return ttsResponse.data; // This is a readable stream

    } catch (error) {
      logger.error(`Voice AI Pipeline Error: ${error.message}`);
      throw error;
    } finally {
      // Clean up the temporary uploaded file securely
      if (fs.existsSync(safePath)) {
        fs.unlinkSync(safePath);
      }
    }
  }
}

export default new VoiceAiService();
