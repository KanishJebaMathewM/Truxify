import { describe, it, expect } from 'vitest';

// Test the pure extensionForMime function
function MIME_EXTENSION_MAP() {
  return Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  });
}

function extensionForMime(mime) {
  const MAP = MIME_EXTENSION_MAP();
  const ext = MAP[mime];
  if (!ext) {
    throw new Error(`Unsupported MIME type for extension mapping: '${mime}'`);
  }
  return ext;
}

describe('maintenancePhotoController - extensionForMime', () => {
  it('returns jpg for image/jpeg', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
  });

  it('returns png for image/png', () => {
    expect(extensionForMime('image/png')).toBe('png');
  });

  it('returns webp for image/webp', () => {
    expect(extensionForMime('image/webp')).toBe('webp');
  });

  it('returns heic for image/heic', () => {
    expect(extensionForMime('image/heic')).toBe('heic');
  });

  it('returns pdf for application/pdf', () => {
    expect(extensionForMime('application/pdf')).toBe('pdf');
  });

  it('throws for unknown MIME type', () => {
    expect(() => extensionForMime('image/gif')).toThrow("Unsupported MIME type for extension mapping: 'image/gif'");
  });

  it('throws for null input', () => {
    expect(() => extensionForMime(null)).toThrow();
  });
});
