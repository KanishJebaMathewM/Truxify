/**
 * Audio Validation Test Fixtures
 * 
 * Provides pre-constructed Buffer instances representing valid and invalid
 * audio file headers for magic-byte inspection testing.
 */

// Valid WAV header: "RIFF" + size + "WAVE"
export const createValidWavBuffer = () => {
    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(2, 22);
    buffer.writeUInt32LE(44100, 24);
    buffer.writeUInt32LE(176400, 28);
    buffer.writeUInt16LE(4, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(0, 40);
    return buffer;
};

// Valid MP3 header with ID3v2 tag: "ID3"
export const createValidMp3Id3Buffer = () => {
    const buffer = Buffer.alloc(10);
    buffer.write('ID3', 0);
    buffer[3] = 0x04; // Version 2.4
    buffer[4] = 0x00;
    buffer[5] = 0x00; // Flags
    buffer[6] = 0x00; // Size byte 1
    buffer[7] = 0x00; // Size byte 2
    buffer[8] = 0x00; // Size byte 3
    buffer[9] = 0x00; // Size byte 4
    return buffer;
};

// Valid bare MP3 header (no ID3): 11 set bits (0xFF 0xFB)
export const createValidBareMp3Buffer = () => {
    const buffer = Buffer.alloc(4);
    buffer[0] = 0xff;
    buffer[1] = 0xfb;
    buffer[2] = 0x90;
    buffer[3] = 0x00;
    return buffer;
};

// Valid M4A/MP4 header: size + "ftyp" + brand
export const createValidM4aBuffer = () => {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt32BE(12, 0);
    buffer.write('ftyp', 4);
    buffer.write('M4A ', 8);
    return buffer;
};

// Valid OGG header: "OggS"
export const createValidOggBuffer = () => {
    const buffer = Buffer.alloc(4);
    buffer.write('OggS', 0);
    return buffer;
};

// Valid WebM/EBML header: 0x1A 0x45 0xDF 0xA3
export const createValidWebmBuffer = () => {
    const buffer = Buffer.alloc(4);
    buffer[0] = 0x1a;
    buffer[1] = 0x45;
    buffer[2] = 0xdf;
    buffer[3] = 0xa3;
    return buffer;
};

// Valid AAC ADTS header: 0xFF 0xF1 or 0xFF 0xF9
export const createValidAacBuffer = () => {
    const buffer = Buffer.alloc(7);
    buffer[0] = 0xff;
    buffer[1] = 0xf1;
    buffer[2] = 0x40;
    buffer[3] = 0x80;
    buffer[4] = 0x00;
    buffer[5] = 0x00;
    buffer[6] = 0x00;
    return buffer;
};

// Invalid: RIFF but not WAVE (e.g., AVI)
export const createInvalidRiffBuffer = () => {
    const buffer = Buffer.alloc(12);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(100, 4);
    buffer.write('AVI ', 8);
    return buffer;
};

// Invalid: Random garbage bytes
export const createInvalidGarbageBuffer = () => {
    return Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
};

// Truncated: Too short to contain any valid signature
export const createTruncatedBuffer = () => {
    return Buffer.from([0x52, 0x49]); // "RI"
};

// Oversized: Valid header but excessively large payload simulation
export const createOversizedBuffer = () => {
    const buffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
    buffer.write('OggS', 0);
    return buffer;
};
