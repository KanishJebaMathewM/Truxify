import axios from 'axios';
import crypto from 'crypto';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const VOICE_API_TIMEOUT_MS = 10000;
const WHISPER_TIMEOUT_MS = 15000;
export const audioCache = new Map();

function trimCache() {
  const now = Date.now();
  // 1. Collect and purge expired entries first
  const expiredKeys = [];
  for (const [key, value] of audioCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      expiredKeys.push(key);
    }
  }
  for (const key of expiredKeys) {
    audioCache.delete(key);
  }

  // 2. If capacity still exceeds MAX_CACHE_SIZE, evict oldest remaining entries
  if (audioCache.size > MAX_CACHE_SIZE) {
    const oldest = [...audioCache.entries()]
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);
    const toDelete = audioCache.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toDelete && i < oldest.length; i++) {
      audioCache.delete(oldest[i][0]);
    }
  }
}

function cacheAudio(id, buffer, userId) {
  audioCache.set(id, { buffer, userId, timestamp: Date.now() });
  trimCache();
}

async function getBookingContext(bookingId, userId) {
  if (!userId) {
    return null;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = uuidRegex.test(bookingId);

  // Orders table is the real order model (there is no bookings table).
  try {
    let orderQuery = supabase.from('orders').select('*');
    if (isUuid) {
      orderQuery = orderQuery.eq('id', bookingId);
    } else {
      orderQuery = orderQuery.eq('order_display_id', bookingId);
    }
    
    orderQuery = orderQuery.or(`customer_id.eq.${userId},driver_id.eq.${userId}`);

    const { data: order, error } = await orderQuery.maybeSingle();
    if (error) {
      logger.warn('Orders table check failed in voiceService:', error.message);
      return null;
    }

    return order;
  } catch (err) {
    logger.warn('Orders table check failed in voiceService:', err.message);
  }
  return null;
}

export async function processVoiceQuery(userId, bookingId, audioBuffer, filename) {
  const bookingData = await getBookingContext(bookingId, userId);
  
  if (!process.env.OPENAI_API_KEY || !process.env.ELEVENLABS_API_KEY) {
    logger.warn('Missing OpenAI or ElevenLabs API keys. Using mock Voice AI pipeline.');
    
    // Choose mock response matching user's query keywords if any
    const queries = [
      {
        transcript: "Where is my package?",
        response_text: bookingData
          ? `Your shipment is currently ${bookingData.status?.replace(/_/g, ' ') || 'in transit'}.`
          : "Your package is currently in transit."
      },
      {
        transcript: "When will it reach?",
        response_text: bookingData
          ? `It is estimated to reach its destination in ${bookingData.eta || '2 hours'}.`
          : "It will reach in approximately 2 hours."
      },
      {
        transcript: "Is my payment released?",
        response_text: bookingData
          ? `Your payment is in status ${bookingData.escrow_status || 'secured in escrow'} and will release upon delivery.`
          : "The payment is currently secured in the smart contract escrow."
      }
    ];

    const selected = queries[crypto.randomInt(0, queries.length)];
    
    // Generate a dummy silent mp3
    const mockAudio = Buffer.alloc(1000);
    const audioId = crypto.randomUUID();
    cacheAudio(audioId, mockAudio, userId);

    return {
      transcript: selected.transcript,
      response_text: selected.response_text,
      audio_url: `/api/voice/audio/${audioId}`
    };
  }

  // Production Whisper call
  let transcript;
  try {
    const boundary = '----VoiceAIBoundary' + crypto.randomBytes(16).toString('hex');
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename || 'audio.wav'}"\r\nContent-Type: audio/wav\r\n\r\n`;
    const footer = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--`;
    const body = Buffer.concat([
      Buffer.from(header, 'utf-8'),
      audioBuffer,
      Buffer.from(footer, 'utf-8')
    ]);

    const whisperResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', body, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      timeout: WHISPER_TIMEOUT_MS
    });
    transcript = whisperResponse.data.text;
  } catch (err) {
    logger.error('Whisper transcription failed:', err.message);
    throw new Error('Transcription failed: ' + err.message, { cause: err });
  }

  // Production LLM call
  let responseText;
  try {
    const systemPrompt = `You are a freight assistant. Answer in 1-2 sentences in the customer's language (Hindi/English/Tamil).\nBooking: ${JSON.stringify(bookingData || {})}`;
    
    const llmResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: VOICE_API_TIMEOUT_MS
    });
    responseText = llmResponse.data.choices[0].message.content;
  } catch (err) {
    logger.error('LLM completion failed:', err.message);
    throw new Error('LLM failed: ' + err.message, { cause: err });
  }

  // Production ElevenLabs TTS call
  let audioUrl;
  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
    const ttsResponse = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      text: responseText,
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5
      }
    }, {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'accept': 'audio/mpeg'
      },
      responseType: 'arraybuffer',
      timeout: VOICE_API_TIMEOUT_MS
    });

    const audioId = crypto.randomUUID();
    cacheAudio(audioId, Buffer.from(ttsResponse.data), userId);
    audioUrl = `/api/voice/audio/${audioId}`;
  } catch (err) {
    logger.error('ElevenLabs TTS failed:', err.message);
    throw new Error('TTS failed: ' + err.message, { cause: err });
  }

  return {
    transcript,
    response_text: responseText,
    audio_url: audioUrl
  };
}

export const __testing = { getBookingContext, trimCache, cacheAudio, MAX_CACHE_SIZE, CACHE_TTL_MS };
