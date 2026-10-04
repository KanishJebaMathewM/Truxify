import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('openai', () => ({
  OpenAI: vi.fn(),
}));

describe('VoiceAiService', () => {
  const OLD_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (OLD_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = OLD_KEY;
    }
  });

  it('constructs without credentials and leaves the client unset', async () => {
    const { VoiceAiService } = await import(
      '../../src/services/voice/VoiceAiService.js'
    );

    const service = new VoiceAiService();

    expect(service.openai).toBeNull();
  });

  it('builds the client when a key is configured', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const { OpenAI } = await import('openai');
    const { VoiceAiService } = await import(
      '../../src/services/voice/VoiceAiService.js'
    );

    const service = new VoiceAiService();

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(service.openai).toBeDefined();
  });

  it('rejects voice queries without credentials with a clear error', async () => {
    const path = await import('node:path');
    const { VoiceAiService } = await import(
      '../../src/services/voice/VoiceAiService.js'
    );

    const service = new VoiceAiService();
    const insideUploads = path.resolve(
      process.cwd(),
      'uploads',
      'voice',
      'note.wav'
    );

    await expect(service.processVoiceQuery(insideUploads, 'en')).rejects.toThrow(
      'Voice AI is not configured'
    );
  });

  it('rejects paths escaping the uploads directory', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const { VoiceAiService } = await import(
      '../../src/services/voice/VoiceAiService.js'
    );

    const service = new VoiceAiService();

    await expect(
      service.processVoiceQuery('/etc/passwd', 'en')
    ).rejects.toThrow('Invalid file path');
  });
});
