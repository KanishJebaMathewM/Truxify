# Audio Validation Test Suite

This directory contains the comprehensive test suite for `backend/api/src/lib/audioValidation.js`.

## Purpose
The `audioValidation.js` module protects the Voice AI upload endpoint by inspecting the magic bytes of uploaded file buffers, ensuring that only permitted audio formats (WAV, MP3, M4A, OGG, WebM, AAC) are accepted, regardless of client-supplied MIME types or file extensions.

## Test Coverage
1. **Valid Formats**: Verifies that correctly formatted headers for WAV, MP3 (with and without ID3), M4A, OGG, WebM, and AAC are correctly identified.
2. **Invalid Formats**: Ensures that non-audio RIFF containers (like AVI) and random garbage bytes are rejected.
3. **Edge Cases**: 
   - Truncated buffers (too short to read signatures).
   - Oversized payloads (valid header, massive buffer).
   - Null, undefined, or non-Buffer inputs.

## Fixtures
Reusable buffer generators are located in `fixtures/audioValidationFixtures.js` to keep test files clean and maintainable.

## Running the Tests
```bash
npm run test -- backend/api/test/unit/audioValidation.test.js
```
