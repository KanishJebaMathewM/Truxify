/**
 * Chat message encryption secret configuration.
 *
 * Centralizes the key used to encrypt chat messages at rest so the service never
 * reads process.env directly and never falls back to a hardcoded secret.
 *
 * Background: chatService.js previously used
 *   process.env.CHAT_ENCRYPTION_SECRET || 'truxify-default-chat-secret-change-me'
 * That literal is committed to a public repository and is absent from the env
 * example and compose files, so a deployment that missed the variable encrypted
 * every chat message with a publicly known key. Anyone with database or backup
 * access could decrypt every conversation.
 *
 * Fail-closed contract:
 *   - In production, CHAT_ENCRYPTION_SECRET must be set and at least
 *     MIN_SECRET_LENGTH characters long. There is no fallback: the getter
 *     throws, so nothing is encrypted or decrypted with a known key.
 *   - Outside production a random per-process secret is generated once and
 *     cached, so local development and tests work without a shared default.
 *     Messages written before a restart cannot be decrypted after it, which is
 *     the intended local behaviour.
 */

import crypto from 'crypto';
import logger from '../middleware/logger.js';

/**
 * Minimum accepted length for a configured CHAT_ENCRYPTION_SECRET, in characters.
 */
export const MIN_SECRET_LENGTH = 32;

/** Number of random bytes used for the non-production fallback secret. */
const FALLBACK_SECRET_BYTES = 48;

let cachedFallbackSecret = null;

/**
 * Returns the configured chat message encryption secret.
 *
 * Read lazily so a configuration failure surfaces as a fail-closed error at
 * encryption/decryption time even if a startup check did not run.
 *
 * @returns {string} The secret to encrypt and decrypt chat messages with.
 * @throws {Error} If CHAT_ENCRYPTION_SECRET is missing or too short in production.
 */
export function getChatEncryptionSecret() {
  const raw = process.env.CHAT_ENCRYPTION_SECRET;
  const secret = typeof raw === 'string' ? raw.trim() : '';

  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `CHAT_ENCRYPTION_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`,
      );
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CHAT_ENCRYPTION_SECRET environment variable is required in production to encrypt chat messages at rest.',
    );
  }

  // Outside production there is no shared default. Generate one per process so
  // that a missing variable can never degrade into a publicly known key.
  if (!cachedFallbackSecret) {
    cachedFallbackSecret = crypto.randomBytes(FALLBACK_SECRET_BYTES).toString('hex');
    logger.warn(
      '[config/chatEncryptionSecret] CHAT_ENCRYPTION_SECRET is not set. Generated a random per-process encryption secret. Messages will not be readable across restarts or instances. Set CHAT_ENCRYPTION_SECRET explicitly.',
    );
  }
  return cachedFallbackSecret;
}

/**
 * Returns true when a usable chat encryption secret is available.
 * @returns {boolean}
 */
export function hasChatEncryptionSecret() {
  try {
    getChatEncryptionSecret();
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Test seam: clears the cached non-production fallback so a test can observe a
 * freshly generated secret. Has no effect on a configured CHAT_ENCRYPTION_SECRET.
 */
export function resetChatEncryptionSecretCache() {
  cachedFallbackSecret = null;
}