import { describe, it, expect } from 'vitest';
import fs from 'fs';

const servicePath = new URL(
  '../../src/services/voice/VoiceAiService.js',
  import.meta.url,
);

const source = fs.readFileSync(servicePath, 'utf8');

describe('VoiceAiService logging privacy', () => {
  it('does not write raw transcription or LLM response content to info logs', () => {
    expect(source).not.toContain('Transcription result: \${userText}');
    expect(source).not.toContain('LLM Response: \${llmResponseText}');
    expect(source).not.toContain('LLM Response: \${responseText}');
  });

  it('logs only metadata for transcription and response completion', () => {
    expect(source).toContain('{ language, transcriptLength:');
    expect(source).toContain("'Voice transcription completed'");
    expect(source).toContain('{ language, responseLength:');
    expect(source).toContain("'LLM response generated'");
  });
});
