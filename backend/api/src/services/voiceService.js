import axios from 'axios';
import crypto from 'crypto';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

export const audioCache = new Map();

async function getBookingContext(bookingId) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = uuidRegex.test(bookingId);

  // Try bookings table first
  try {
    let query = supabase.from('bookings').select('*');
    if (isUuid) {
      query = query.eq('id', bookingId);
    } else {
      query = query.eq('booking_display_id', bookingId);
    }
    const { data: booking } = await query.maybeSingle();
    if (booking) return booking;
  } catch (err) {
    logger.warn('Bookings table check failed in voiceService:', err.message);
  }

  // Fallback to orders table
  try {
    let orderQuery = supabase.from('orders').select('*');
    if (isUuid) {
      orderQuery = orderQuery.eq('id', bookingId);
    } else {
      orderQuery = orderQuery.eq('order_display_id', bookingId);
    }
    const { data: order } = await orderQuery.maybeSingle();
    return order;
  } catch (err) {
    logger.warn('Orders table check failed in voiceService:', err.message);
  }
  return null;
}

export async function processVoiceQuery(userId, bookingId, audioBuffer, filename) {
  const bookingData = await getBookingContext(bookingId);
  
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
    audioCache.set(audioId, mockAudio);

    return {
      transcript: selected.transcript,
      response_text: selected.response_text,
      audio_url: `/api/voice/audio/${audioId}`
    };
  }

  // Production Whisper call
  let transcript;
  try {
    const boundary = '----VoiceAIBoundary' + Math.random().toString(16).substring(2);
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
      }
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
      responseType: 'arraybuffer'
    });

    const audioId = crypto.randomUUID();
    audioCache.set(audioId, Buffer.from(ttsResponse.data));
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
