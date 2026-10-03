import { describe, it, expect } from 'vitest';
import { translateVoiceTransmission } from '../../src/services/cbTranslator.js';

describe('cbTranslator service', () => {
  it('translates common dispatch phrases accurately into Spanish (ES)', () => {
    const result = translateVoiceTransmission({
      channelId: 'CH_ROAD_ALERT',
      senderId: 'DISPATCH_HQ',
      transcriptText: 'caution icy bridge ahead',
      sourceLanguage: 'EN',
      targetLanguage: 'ES',
    });

    expect(result.channelId).toBe('CH_ROAD_ALERT');
    expect(result.senderId).toBe('DISPATCH_HQ');
    expect(result.source.language).toBe('English');
    expect(result.source.originalTranscript).toBe('caution icy bridge ahead');
    expect(result.target.language).toBe('Spanish');
    expect(result.target.translatedTranscript).toBe('Precaución puente helado adelante');
    expect(result.target.synthesizedAudioUrl).toMatch(/^\/api\/cb\/audio-stream\/cb-msg-\d+-\d+\.wav$/);
    expect(result.latencyMs).toBe(120);
    expect(result.timestamp).toBeDefined();
  });

  it('translates common dispatch phrases accurately into Punjabi (PA)', () => {
    const result = translateVoiceTransmission({
      transcriptText: 'proceed to dock door 14',
      sourceLanguage: 'EN',
      targetLanguage: 'PA',
    });

    expect(result.source.language).toBe('English');
    expect(result.target.language).toBe('Punjabi');
    expect(result.target.translatedTranscript).toBe("ਡੌਕ ਡੋਰ 14 'ਤੇ ਜਾਓ");
  });

  it('falls back to synthesized translation format when phrase is not in mock dictionary', () => {
    const result = translateVoiceTransmission({
      transcriptText: 'fuel stop at exit 45',
      sourceLanguage: 'EN',
      targetLanguage: 'ES',
    });

    expect(result.target.translatedTranscript).toBe('[Translated to Spanish]: fuel stop at exit 45');
  });

  it('handles unknown or custom target language gracefully with raw key fallback', () => {
    const result = translateVoiceTransmission({
      transcriptText: 'prepare for inspection',
      sourceLanguage: 'EN',
      targetLanguage: 'DE',
    });

    expect(result.target.language).toBe('DE');
    expect(result.target.translatedTranscript).toBe('[Translated to DE]: prepare for inspection');
  });

  it('applies default parameters when transmissionParams is empty or partial', () => {
    const result = translateVoiceTransmission({});

    expect(result.channelId).toBe('CHANNEL_09_DISPATCH');
    expect(result.senderId).toBe('DISPATCH_MGR_01');
    expect(result.source.language).toBe('English');
    expect(result.target.language).toBe('Spanish');
  });
});
