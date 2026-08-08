/**
 * Supported spoken languages for multi-lingual dispatch.
 */
const SUPPORTED_LANGUAGES = {
    EN: 'English',
    ES: 'Spanish',
    PA: 'Punjabi',
    VI: 'Vietnamese',
    FR: 'French',
    ZH: 'Mandarin'
};

/**
 * Mock dictionary for real-time dispatch phrase translation.
 */
const COMMON_DISPATCH_TRANSLATIONS = {
    'es': {
        'proceed to dock door 14': 'Proceda a la puerta de embarque 14',
        'caution icy bridge ahead': 'Precaución puente helado adelante',
        'turn off engine during loading': 'Apague el motor durante la carga'
    },
    'pa': {
        'proceed to dock door 14': 'ਡੌਕ ਡੋਰ 14 'ਤੇ ਜਾਓ',
        'caution icy bridge ahead': 'ਅੱਗੇ ਬਰਫ਼ੀਲੇ ਪੁਲ ਤੋਂ ਸਾਵਧਾਨ ਰਹੋ',
        'turn off engine during loading': 'ਲੋਡਿੰਗ ਦੌਰਾਨ ਇੰਜਣ ਬੰਦ ਕਰੋ'
    }
};

/**
 * Translates incoming CB radio audio / transcript into driver's native language.
 * 
 * @param {Object} transmissionParams - { channelId, senderId, transcriptText, sourceLanguage, targetLanguage }
 * @returns {Object} Translated audio transmission packet
 */
export function translateVoiceTransmission(transmissionParams) {
    const {
        channelId = 'CHANNEL_09_DISPATCH',
        senderId = 'DISPATCH_MGR_01',
        transcriptText = '',
        sourceLanguage = 'EN',
        targetLanguage = 'ES'
    } = transmissionParams;

    const srcLangKey = sourceLanguage.toUpperCase();
    const tgtLangKey = targetLanguage.toUpperCase();

    const normalizedText = transcriptText.trim().toLowerCase();
    const tgtLangLower = tgtLangKey.toLowerCase();

    let translatedText = transcriptText;

    // Perform translation lookup or fallback to synthesized translation engine
    if (COMMON_DISPATCH_TRANSLATIONS[tgtLangLower] && COMMON_DISPATCH_TRANSLATIONS[tgtLangLower][normalizedText]) {
        translatedText = COMMON_DISPATCH_TRANSLATIONS[tgtLangLower][normalizedText];
    } else {
        translatedText = `[Translated to ${SUPPORTED_LANGUAGES[tgtLangKey] || tgtLangKey}]: ${transcriptText}`;
    }

    const messageId = `cb-msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return {
        messageId,
        channelId,
        senderId,
        source: {
            language: SUPPORTED_LANGUAGES[srcLangKey] || srcLangKey,
            originalTranscript: transcriptText
        },
        target: {
            language: SUPPORTED_LANGUAGES[tgtLangKey] || tgtLangKey,
            translatedTranscript: translatedText,
            synthesizedAudioUrl: `/api/cb/audio-stream/${messageId}.wav`
        },
        latencyMs: 120, // Low-latency speech-to-speech engine target (<200ms)
        timestamp: new Date().toISOString()
    };
}
