import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({}));

describe('VoiceAiService', () => {
  let VoiceAiService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    VoiceAiService = (await import('../../src/services/voice/VoiceAiService.js')).default;
  });

  describe('processVoiceCommand', () => {
    it('parses accept command correctly', async () => {
      const result = await VoiceAiService.processVoiceCommand('accept the bid');
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('entities');
    });

    it('parses reject command correctly', async () => {
      const result = await VoiceAiService.processVoiceCommand('reject the order');
      expect(result.intent).toMatch(/reject|cancel/);
    });

    it('parses navigate command correctly', async () => {
      const result = await VoiceAiService.processVoiceCommand('navigate to the pickup');
      expect(result.intent).toMatch(/navigate|location/);
    });

    it('returns null intent for unrecognized command', async () => {
      const result = await VoiceAiService.processVoiceCommand('asdfghjkl random text');
      expect(result.intent).toBeNull();
    });
  });
});
