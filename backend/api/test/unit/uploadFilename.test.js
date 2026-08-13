/**
 * Coverage for upload filename sanitisation.
 *
 * `file.originalname` is entirely client-controlled and previously flowed
 * unsanitised from the voice upload endpoint into the speech pipeline.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeUploadFilename } from '../../src/lib/uploadFilename.js';

describe('sanitizeUploadFilename', () => {
  it('passes an ordinary filename through unchanged', () => {
    expect(sanitizeUploadFilename('voice-query.wav')).toBe('voice-query.wav');
    expect(sanitizeUploadFilename('recording_01.mp3')).toBe('recording_01.mp3');
  });

  it('strips POSIX directory components', () => {
    expect(sanitizeUploadFilename('/etc/passwd')).toBe('passwd');
    expect(sanitizeUploadFilename('../../etc/passwd')).toBe('passwd');
  });

  it('strips Windows directory components on any platform', () => {
    // path.basename would not handle backslashes on a POSIX server.
    expect(sanitizeUploadFilename('..\\..\\windows\\system32\\config')).toBe('config');
    expect(sanitizeUploadFilename('C:\\temp\\audio.wav')).toBe('audio.wav');
  });

  it('neutralises traversal sequences that survive separator stripping', () => {
    const result = sanitizeUploadFilename('....//....//evil.wav');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('removes NUL bytes and control characters', () => {
    expect(sanitizeUploadFilename('audio\x00.wav')).toBe('audio.wav');
    expect(sanitizeUploadFilename('au\x07dio\x1f.wav')).toBe('audio.wav');
  });

  it('collapses shell metacharacters to underscores', () => {
    const result = sanitizeUploadFilename('audio;rm -rf ~.wav');
    expect(result).not.toMatch(/[;~ ]/);
    expect(result).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('strips leading dots so the result is never a hidden file', () => {
    expect(sanitizeUploadFilename('.hidden.wav')).toBe('hidden.wav');
    expect(sanitizeUploadFilename('...wav')).toBe('wav');
  });

  it('truncates an over-long name while preserving the extension', () => {
    const long = `${'a'.repeat(500)}.wav`;
    const result = sanitizeUploadFilename(long);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('.wav')).toBe(true);
  });

  it('falls back for empty, whitespace-only and non-string input', () => {
    expect(sanitizeUploadFilename('')).toBe('upload');
    expect(sanitizeUploadFilename(null)).toBe('upload');
    expect(sanitizeUploadFilename(undefined)).toBe('upload');
    expect(sanitizeUploadFilename(42)).toBe('upload');
    expect(sanitizeUploadFilename({})).toBe('upload');
  });

  it('falls back when nothing survives sanitisation', () => {
    expect(sanitizeUploadFilename('/')).toBe('upload');
    expect(sanitizeUploadFilename('...')).toBe('upload');
    expect(sanitizeUploadFilename('\x00\x01')).toBe('upload');
  });

  it('rejects Windows reserved device names', () => {
    expect(sanitizeUploadFilename('CON')).toBe('upload');
    expect(sanitizeUploadFilename('con.wav')).toBe('upload');
    expect(sanitizeUploadFilename('LPT1.mp3')).toBe('upload');
    expect(sanitizeUploadFilename('nul')).toBe('upload');
  });

  it('honours a caller-supplied fallback', () => {
    expect(sanitizeUploadFilename('', 'voice-query.wav')).toBe('voice-query.wav');
    expect(sanitizeUploadFilename(null, 'photo.jpg')).toBe('photo.jpg');
  });

  it('always returns a non-empty string with no separators', () => {
    const hostile = [
      '../../../../root/.ssh/authorized_keys',
      '..\\..\\..\\boot.ini',
      'a/b/c/../../../d.wav',
      '\x00../etc/shadow',
      '   ',
      '$(whoami).wav',
      '`id`.mp3',
      'file\nname.wav',
    ];

    for (const input of hostile) {
      const result = sanitizeUploadFilename(input);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
      expect(result).not.toContain('..');
      expect(result).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});
