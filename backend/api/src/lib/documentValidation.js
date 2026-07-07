/**
 * Server-side document content validation for driver KYC uploads.
 *
 * The client (Flutter app) can only tell us the declared MIME type and the
 * file extension the user picked, both of which are trivially spoofable
 * (rename a script to photo.jpg). This module inspects the first bytes of
 * the actual file content ("magic bytes") to determine the real file type,
 * independent of anything the client claims.
 */

export const ALLOWED_DOCUMENT_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);

const SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
];

function matchesSignature(buffer, signature) {
  if (buffer.length < signature.bytes.length) {
    return false;
  }
  for (let i = 0; i < signature.bytes.length; i += 1) {
    if (buffer[i] !== signature.bytes[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Detects the real MIME type of a buffer by inspecting its magic bytes.
 * Returns null if the content doesn't match any allowed document type,
 * regardless of what extension or Content-Type the client supplied.
 */
export function detectDocumentMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }
  const match = SIGNATURES.find((signature) => matchesSignature(buffer, signature));
  return match ? match.mime : null;
}

/**
 * Validates that a document upload's real content matches an allowed type
 * and, if a declared MIME type was supplied, that it agrees with the
 * detected content. Throws a DocumentValidationError with a safe, specific
 * message on failure; returns the verified MIME type on success.
 */
export function validateDocumentBuffer(buffer, declaredMimeType) {
  const detected = detectDocumentMimeType(buffer);

  if (!detected || !ALLOWED_DOCUMENT_MIME_TYPES.includes(detected)) {
    throw new DocumentValidationError(
      `Invalid document type: ${detected ?? 'unknown'}. Only JPEG, PNG, and PDF are accepted.`
    );
  }

  if (declaredMimeType && detected !== declaredMimeType) {
    throw new DocumentValidationError(
      `File content (${detected}) does not match declared type (${declaredMimeType}).`
    );
  }

  return detected;
}

export class DocumentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}
