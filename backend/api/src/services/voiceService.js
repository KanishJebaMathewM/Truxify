import axios from 'axios';
import crypto from 'crypto';
import { supabase, supabaseAdmin } from '../config/db.js';
const voiceDb = (supabaseAdmin && typeof supabaseAdmin.from === 'function') ? supabaseAdmin : supabase;
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

  if (bookingId == null) {
    return null;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = uuidRegex.test(bookingId);

  // Orders table is the real order model (there is no bookings table).
  try {
    let orderQuery = voiceDb.from('orders').select('*');
    if (isUuid) {
      orderQuery = orderQuery.eq('id', bookingId);
    } else {
      orderQuery = orderQuery
        .or(`customer_id.eq.${userId},driver_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(1);
    }

    const { data: order, error } = await orderQuery.maybeSingle();
    if (error) {
      logger.warn('Orders table check failed in voiceService:', error?.message ?? String(error));
      return null;
    }

    return order;
  } catch (err) {
    logger.warn('Orders table check failed in voiceService:', err?.message ?? String(err));
  }
  return null;
}

function detectQueryIntent(transcript) {
  const text = (transcript || '').toLowerCase();
  if (text.includes('payment') || text.includes('release') || text.includes('paid')) {
    return 'payment_status';
  }
  if (text.includes('arrive') || text.includes('arrival') || text.includes('eta') || text.includes('when')) {
    return 'eta';
  }
  return 'package_status';
}

function buildResponseForIntent(intent, bookingData, transcript) {
  const orderRef = bookingData?.order_display_id || bookingData?.id || 'your order';
  const status = bookingData?.status || bookingData?.current_status || 'in transit';
  switch (intent) {
    case 'payment_status':
      return `Your payment for ${orderRef} is ${bookingData?.escrow_status || 'processing'}.`;
    case 'eta':
      return `Your shipment for ${orderRef} is ${status} and is on schedule.`;
    default:
      return `Your shipment ${orderRef} is currently ${status}.`;
  }
}

export async function processVoiceQuery(userId, bookingId, audioBuffer, filename, textQuery = null) {
  const bookingData = await getBookingContext(bookingId, userId);
  
  if (!process.env.OPENAI_API_KEY || !process.env.ELEVENLABS_API_KEY) {
    logger.warn('Missing OpenAI or ElevenLabs API keys. Using mock Voice AI intent pipeline.');

    let transcript = textQuery || 'Where is my package?';
    if (!textQuery && audioBuffer) {
      // Deterministically sample query based on buffer byte content or intent matching
      const querySamples = [
        'Where is my package?',
        'When will it arrive?',
        'Is my payment released?'
      ];
      const byteSum = audioBuffer.reduce((acc, val) => acc + val, 0);
      transcript = querySamples[byteSum % querySamples.length];
    }

    const intent = detectQueryIntent(transcript);
    const responseText = buildResponseForIntent(intent, bookingData, transcript);

    const mockAudio = Buffer.alloc(1000);
    const audioId = crypto.randomUUID();
    cacheAudio(audioId, mockAudio, userId);

    return {
      transcript,
      response_text: responseText,
      audio_url: `/api/voice/audio/${audioId}`,
      intent
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
    logger.error('Whisper transcription failed:', err?.message ?? String(err));
    throw new Error('Transcription failed: ' + (err?.message ?? String(err)), { cause: err });
  }

  const intent = detectQueryIntent(transcript);

  // Production LLM call
  let responseText;
  try {
    const systemPrompt = `You are Truxify Voice AI Assistant for freight tracking. Answer in 1-2 concise sentences in the customer's language (English/Hindi/Tamil). Focus on intent: ${intent}.\nOrder Context: ${JSON.stringify(bookingData || {})}`;

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
    logger.error('LLM completion failed:', err?.message ?? String(err));
    throw new Error('LLM failed: ' + (err?.message ?? String(err)), { cause: err });
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
    logger.error('ElevenLabs TTS failed:', err?.message ?? String(err));
    throw new Error('TTS failed: ' + (err?.message ?? String(err)), { cause: err });
  }

  return {
    transcript,
    response_text: responseText,
    audio_url: audioUrl,
    intent
  };
}

export const __testing = { getBookingContext, trimCache, cacheAudio, MAX_CACHE_SIZE, CACHE_TTL_MS };
