const axios = require('axios');
const FormData = require('form-data');

const WHISPER_API_URL = process.env.WHISPER_API_URL || 'http://localhost:8000/v1/audio/transcriptions';
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

const transcribeAudio = async (audioBuffer, mimeType) => {
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.webm', contentType: mimeType });
    form.append('model', 'whisper-1');

    try {
        const response = await axios.post(WHISPER_API_URL, form, {
            headers: form.getHeaders(),
        });
        return response.data.text;
    } catch (err) {
        console.error('Whisper transcription failed:', err.message);
        throw new Error('Failed to transcribe audio');
    }
};

const generateLLMResponse = async (transcript, bookingData, language = 'English') => {
    const systemPrompt = `You are a freight assistant. Answer in 1-2 sentences in the customer's language (${language}).\nBooking: ${JSON.stringify(bookingData)}`;

    try {
        const response = await axios.post(LLM_API_URL, {
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: transcript },
            ],
            max_tokens: 100,
        });
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error('LLM generation failed:', err.message);
        throw new Error('Failed to generate response');
    }
};

const generateTTS = async (text) => {
    if (!ELEVENLABS_API_KEY) {
        console.warn('ElevenLabs API key missing, skipping TTS');
        return null;
    }

    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
            {
                text: text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: { stability: 0.5, similarity_boost: 0.5 },
            },
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                    Accept: 'audio/mpeg',
                },
                responseType: 'arraybuffer',
            }
        );

        const base64Audio = Buffer.from(response.data).toString('base64');
        return `data:audio/mpeg;base64,${base64Audio}`;
    } catch (err) {
        console.error('ElevenLabs TTS failed:', err.message);
        throw new Error('Failed to generate audio');
    }
};

module.exports = {
    transcribeAudio,
    generateLLMResponse,
    generateTTS,
};
