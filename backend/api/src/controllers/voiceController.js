const voiceAiService = require('../services/voiceAiService');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const handleVoiceQuery = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Audio file is required' });
        }

        const { language, bookingId } = req.body;
        const audioBuffer = req.file.buffer;
        const mimeType = req.file.mimetype;

        const transcript = await voiceAiService.transcribeAudio(audioBuffer, mimeType);

        let bookingData = {};
        if (bookingId) {
            const { data } = await supabase
                .from('bookings')
                .select('*')
                .eq('id', bookingId)
                .single();
            bookingData = data || {};
        }

        const responseText = await voiceAiService.generateLLMResponse(transcript, bookingData, language);
        const audioUrl = await voiceAiService.generateTTS(responseText);

        return res.status(200).json({
            success: true,
            transcript,
            response_text: responseText,
            audio_url: audioUrl,
        });
    } catch (err) {
        console.error('Voice query error:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    handleVoiceQuery,
};
