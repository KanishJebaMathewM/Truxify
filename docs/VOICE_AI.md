# Voice AI Assistant

## Overview

The Truxify backend powers a voice assistant for drivers (`services/voice/VoiceAiService.js` + `routes/voice.routes.js`): audio is uploaded, transcribed, processed by an LLM, and answered with text-to-speech audio streamed back to the client.

---

## Location

```
backend/api/src/services/voice/VoiceAiService.js
backend/api/src/services/voiceService.js
backend/api/src/routes/voice.routes.js
```

---

## Flow

1. **Upload** — `POST /api/v1/voice/assistant` accepts an audio file (multer, 10 MB limit, audio MIME filter; content validated by `lib/audioValidation.js` magic bytes).
2. **Transcription** — the audio is sent to the speech-to-text pipeline.
3. **LLM** — the transcribed query is processed with the driver/order context.
4. **TTS** — the response is synthesized and streamed back as `audio/mpeg`.

---

## Safety

- Filenames are sanitized (`lib/uploadFilename.js`) before reaching storage/logs.
- Audio content is validated by magic bytes, not the declared type.
- Errors return `500 Failed to process voice query` without leaking internals.

---

## Why It Exists

Drivers are hands-busy; a voice assistant makes load updates, status changes, and queries safe while driving.

---

## Testing

Automated tests verify:

- Missing-file and invalid-type handling.
- Voice AI service processing and streaming.
- Filename/content validation on the upload path.
