import axios from 'axios';
import crypto from 'crypto';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
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

  try {
    let orderQuery = supabase.from('orders').select('*');
    if (bookingId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(bookingId)) {
        orderQuery = orderQuery.eq('id', bookingId);
      } else {
        orderQuery = orderQuery.eq('order_display_id', bookingId);
      }
      orderQuery = orderQuery.or(`customer_id.eq.${userId},driver_id.eq.${userId}`);
    } else {
      orderQuery = orderQuery
        .or(`customer_id.eq.${userId},driver_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(1);
    }

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

function detectQueryIntent(text = '') {
  const lower = text.toLowerCase();
  if (
    lower.includes('where') ||
    lower.includes('location') ||
    lower.includes('package') ||
    lower.includes('truck') ||
    lower.includes('shipment') ||
    lower.includes('कहाँ') ||
    lower.includes('काह') ||
    lower.includes('எங்கே')
  ) {
    return 'location';
  }
  if (
    lower.includes('when') ||
    lower.includes('reach') ||
    lower.includes('arrive') ||
    lower.includes('eta') ||
    lower.includes('time') ||
    lower.includes('कब') ||
    lower.includes('எப்போது')
  ) {
    return 'eta';
  }
  if (
    lower.includes('payment') ||
    lower.includes('released') ||
    lower.includes('escrow') ||
    lower.includes('pay') ||
    lower.includes('money') ||
    lower.includes('भुगतान') ||
    lower.includes('பணம்')
  ) {
    return 'escrow';
  }
  return 'general';
}

function buildResponseForIntent(intent, bookingData, transcriptText) {
  const orderId = bookingData?.order_display_id || bookingData?.id || 'your order';
  const status = bookingData?.status?.replace(/_/g, ' ') || 'in transit';

  switch (intent) {
    case 'location': {
      const loc = bookingData?.current_location_name || bookingData?.drop_address || 'en route to destination';
      return `Your shipment (${orderId}) is currently ${status} near ${loc}.`;
    }
    case 'eta': {
      const eta = bookingData?.eta || '45 minutes';
      return `Your shipment (${orderId}) is estimated to reach its destination in ${eta}.`;
    }
    case 'escrow': {
      const escrowStatus = bookingData?.escrow_status || 'secured in smart contract escrow';
      return `Payment for ${orderId} is currently ${escrowStatus} and will release upon delivery.`;
    }
    default:
      return bookingData
        ? `Your shipment (${orderId}) is currently ${status}.`
        : `Your query "${transcriptText}" has been processed. Shipment status is normal.`;
  }
}

export async function processVoiceQuery(userId, bookingId, audioBuffer, filename, textQuery) {
  const bookingData = await getBookingContext(bookingId, userId);

  // If no OpenAI/ElevenLabs API key, use local intent pipeline
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

  // Production Whisper call or text transcript
  let transcript = textQuery;
  if (!transcript && audioBuffer) {
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
        }
      });
      transcript = whisperResponse.data.text;
    } catch (err) {
      logger.error('Whisper transcription failed:', err.message);
      throw new Error('Transcription failed: ' + err.message, { cause: err });
    }
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
      }
    });
    responseText = llmResponse.data.choices[0].message.content;
  } catch (err) {
    logger.warn('LLM completion failed, falling back to rule-based intent response:', err.message);
    responseText = buildResponseForIntent(intent, bookingData, transcript);
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
      responseType: 'arraybuffer'
    });

    const audioId = crypto.randomUUID();
    cacheAudio(audioId, Buffer.from(ttsResponse.data), userId);
    audioUrl = `/api/voice/audio/${audioId}`;
  } catch (err) {
    logger.warn('ElevenLabs TTS failed:', err.message);
    const mockAudio = Buffer.alloc(1000);
    const audioId = crypto.randomUUID();
    cacheAudio(audioId, mockAudio, userId);
    audioUrl = `/api/voice/audio/${audioId}`;
  }

  return {
    transcript,
    response_text: responseText,
    audio_url: audioUrl,
    intent
  };
}

export const __testing = { getBookingContext, trimCache, cacheAudio, MAX_CACHE_SIZE, CACHE_TTL_MS };
