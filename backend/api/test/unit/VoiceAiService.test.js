import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

const mocks = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  axiosPost: vi.fn(),
  fs: {
    createReadStream: vi.fn(() => ({})),
    existsSync: vi.fn(() => true),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({ default: mocks.fs }));

vi.mock('openai', () => ({
  OpenAI: class {
    constructor() {
      this.audio = { transcriptions: { create: mocks.openaiCreate } };
      this.chat = { completions: { create: mocks.openaiCreate } };
    }
  },
}));

vi.mock('axios', () => ({
  default: { post: mocks.axiosPost },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('VoiceAiService', () => {
  let service;
  const AUDIO_PATH = path.resolve(process.cwd(), 'uploads', 'voice', 'command.mp3');

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = 'test-api-key';
    mocks.openaiCreate.mockReset();
    mocks.axiosPost.mockReset();
    mocks.fs.unlinkSync.mockReset();
    mocks.openaiCreate
      .mockResolvedValueOnce({ text: 'where is my truck' })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Your truck is at the depot.' } }] });
    mocks.axiosPost.mockResolvedValue({ data: { _isTtsStream: true } });

    vi.resetModules();
    service = (await import('../../src/services/voice/VoiceAiService.js')).default;
  });

  it('default export is a VoiceAiService instance exposing processVoiceQuery', () => {
    expect(service).toBeTruthy();
    expect(typeof service.processVoiceQuery).toBe('function');
  });

  it('rejects audio paths outside the uploads/voice directory', async () => {
    await expect(
      service.processVoiceQuery('C:\\windows\\system32\\noise.mp3', 'en')
    ).rejects.toThrow(/Security Error: Invalid file path detected\./);
  });

  it('transcribes the audio, answers it and returns the TTS stream', async () => {
    const result = await service.processVoiceQuery(AUDIO_PATH, 'en');

    expect(mocks.openaiCreate).toHaveBeenCalledTimes(2);
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1);
    expect(mocks.axiosPost.mock.calls[0][0]).toContain('api.elevenlabs.io');
    expect(result).toEqual({ _isTtsStream: true });
  });

  it('falls back to English for unsupported languages', async () => {
    await service.processVoiceQuery(AUDIO_PATH, 'fr');

    const completionCall = mocks.openaiCreate.mock.calls[1][0];
    const systemContent = completionCall.messages[0].content;
    expect(systemContent).toContain('English');
  });

  it('cleans up the temporary audio file after processing', async () => {
    await service.processVoiceQuery(AUDIO_PATH, 'en');
    expect(mocks.fs.unlinkSync).toHaveBeenCalledWith(AUDIO_PATH);
  });
});
