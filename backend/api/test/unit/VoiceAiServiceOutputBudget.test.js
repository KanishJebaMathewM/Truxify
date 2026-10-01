import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  chatCompletion: vi.fn(),
  ttsPost: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    createReadStream: vi.fn(() => ({})),
    existsSync: vi.fn(() => false),
    unlinkSync: vi.fn(),
  },
}));

vi.mock('openai', () => ({
  OpenAI: class MockOpenAI {
    constructor() {
      this.audio = {
        transcriptions: {
          create: mocks.transcribe,
        },
      };
      this.chat = {
        completions: {
          create: mocks.chatCompletion,
        },
      };
    }
  },
}));

vi.mock('axios', () => ({
  default: {
    post: mocks.ttsPost,
  },
}));

let voiceAiService;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
  process.env.VOICE_AI_MAX_OUTPUT_TOKENS = '120';
  process.env.VOICE_AI_MAX_RESPONSE_CHARS = '100';

  const module = await import('../../src/services/voice/VoiceAiService.js');
  voiceAiService = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transcribe.mockResolvedValue({ text: 'Where is my truck?' });
});

describe('VoiceAiService output budget', () => {
  it('sends an explicit completion token budget to OpenAI', async () => {
    mocks.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Your truck is nearby.' } }],
    });
    mocks.ttsPost.mockResolvedValue({ data: 'tts-stream' });

    await voiceAiService.processVoiceQuery('uploads/voice/audio.wav');

    expect(mocks.chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        max_completion_tokens: 120,
      })
    );
  });

  it('blocks oversized LLM output before ElevenLabs is called', async () => {
    mocks.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'x'.repeat(101) } }],
    });

    await expect(
      voiceAiService.processVoiceQuery('uploads/voice/audio.wav')
    ).rejects.toThrow('LLM response exceeds the voice response limit');

    expect(mocks.ttsPost).not.toHaveBeenCalled();
  });

  it('trims acceptable output before sending it to ElevenLabs', async () => {
    mocks.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: '  Your truck is nearby.  ' } }],
    });
    mocks.ttsPost.mockResolvedValue({ data: 'tts-stream' });

    await voiceAiService.processVoiceQuery('uploads/voice/audio.wav');

    expect(mocks.ttsPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: 'Your truck is nearby.' }),
      expect.any(Object)
    );
  });

  it('rejects an empty LLM response before ElevenLabs is called', async () => {
    mocks.chatCompletion.mockResolvedValue({
      choices: [{ message: { content: '   ' } }],
    });

    await expect(
      voiceAiService.processVoiceQuery('uploads/voice/audio.wav')
    ).rejects.toThrow('LLM returned an empty response');

    expect(mocks.ttsPost).not.toHaveBeenCalled();
  });
});
