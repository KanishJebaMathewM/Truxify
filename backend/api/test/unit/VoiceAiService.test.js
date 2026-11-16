import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openAiConstructor: vi.fn(),
  transcribe: vi.fn(),
  chatCompletion: vi.fn(),
  ttsPost: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    createReadStream: vi.fn(() => ({})),
    existsSync: mocks.existsSync,
    unlinkSync: mocks.unlinkSync,
  },
}));

// Mirrors the real SDK: constructing a client without an API key throws.
vi.mock('openai', () => ({
  OpenAI: class MockOpenAI {
    constructor(options = {}) {
      mocks.openAiConstructor(options);
      if (!options.apiKey) {
        throw new Error('Missing credentials. Please pass an `apiKey`.');
      }
      this.audio = { transcriptions: { create: mocks.transcribe } };
      this.chat = { completions: { create: mocks.chatCompletion } };
    }
  },
}));

vi.mock('axios', () => ({
  default: { post: mocks.ttsPost },
}));

const audioPath = path.resolve(process.cwd(), 'uploads', 'voice', 'clip.webm');
const ttsStream = { pipe: vi.fn() };

async function loadService() {
  vi.resetModules();
  return (await import('../../src/services/voice/VoiceAiService.js')).default;
}

describe('VoiceAiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-elevenlabs-key');
    mocks.existsSync.mockReturnValue(true);
    mocks.transcribe.mockResolvedValue({ text: 'Where is my truck?' });
    mocks.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Your truck is 5 km away.' } }],
    });
    mocks.ttsPost.mockResolvedValue({ data: ttsStream });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('without OPENAI_API_KEY', () => {
    beforeEach(() => {
      vi.stubEnv('OPENAI_API_KEY', '');
    });

    it('can be imported without throwing', async () => {
      await expect(loadService()).resolves.toBeDefined();
      expect(mocks.openAiConstructor).not.toHaveBeenCalled();
    });

    it('rejects processVoiceQuery with a clear error and still removes the upload', async () => {
      const service = await loadService();

      await expect(service.processVoiceQuery(audioPath, 'en')).rejects.toThrow(
        'OPENAI_API_KEY is not configured'
      );
      expect(mocks.openAiConstructor).not.toHaveBeenCalled();
      expect(mocks.ttsPost).not.toHaveBeenCalled();
      expect(mocks.unlinkSync).toHaveBeenCalledWith(audioPath);
    });
  });

  describe('processVoiceQuery', () => {
    it('transcribes, answers and returns the TTS stream', async () => {
      const service = await loadService();

      const result = await service.processVoiceQuery(audioPath, 'hi');

      expect(result).toBe(ttsStream);
      expect(mocks.openAiConstructor).toHaveBeenCalledWith({ apiKey: 'test-openai-key' });
      expect(mocks.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'whisper-1', language: 'hi' })
      );
      expect(mocks.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([{ role: 'user', content: 'Where is my truck?' }]),
        })
      );
      expect(mocks.ttsPost).toHaveBeenCalledWith(
        expect.stringContaining(`/text-to-speech/${service.voiceIds.hi}/stream`),
        expect.objectContaining({ text: 'Your truck is 5 km away.' }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'xi-api-key': 'test-elevenlabs-key' }),
        })
      );
      expect(mocks.unlinkSync).toHaveBeenCalledWith(audioPath);
    });

    it('creates the OpenAI client once and reuses it', async () => {
      const service = await loadService();

      await service.processVoiceQuery(audioPath, 'en');
      await service.processVoiceQuery(audioPath, 'en');

      expect(mocks.openAiConstructor).toHaveBeenCalledTimes(1);
    });

    it('falls back to English for an unsupported language', async () => {
      const service = await loadService();

      await service.processVoiceQuery(audioPath, 'fr');

      expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
      expect(mocks.ttsPost).toHaveBeenCalledWith(
        expect.stringContaining(`/text-to-speech/${service.voiceIds.en}/stream`),
        expect.anything(),
        expect.anything()
      );
    });

    it('rejects a path outside the voice upload directory', async () => {
      const service = await loadService();

      await expect(service.processVoiceQuery('/etc/passwd', 'en')).rejects.toThrow(
        'Security Error: Invalid file path detected.'
      );
      expect(mocks.transcribe).not.toHaveBeenCalled();
      expect(mocks.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
