import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  MIN_SECRET_LENGTH,
  getChatEncryptionSecret,
  hasChatEncryptionSecret,
  resetChatEncryptionSecretCache,
} from '../../../src/config/chatEncryptionSecret.js';

const VALID_SECRET = 'a'.repeat(MIN_SECRET_LENGTH);
const ORIGINAL_ENV = { ...process.env };

/**
 * The literal that used to be hardcoded in chatService.js. It is asserted
 * against below because as long as it is present in the repository the
 * vulnerability can be reintroduced by a single careless edit.
 */
const REMOVED_FALLBACK = 'truxify-default-chat-secret-change-me';

function setEnv({ chatSecret, nodeEnv }) {
  if (chatSecret === undefined) {
    delete process.env.CHAT_ENCRYPTION_SECRET;
  } else {
    process.env.CHAT_ENCRYPTION_SECRET = chatSecret;
  }
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
}

describe('config/chatEncryptionSecret', () => {
  beforeEach(() => {
    resetChatEncryptionSecretCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetChatEncryptionSecretCache();
  });

  describe('with CHAT_ENCRYPTION_SECRET configured', () => {
    it('returns the configured secret', () => {
      setEnv({ chatSecret: VALID_SECRET, nodeEnv: 'production' });

      expect(getChatEncryptionSecret()).toBe(VALID_SECRET);
      expect(hasChatEncryptionSecret()).toBe(true);
    });

    it('trims surrounding whitespace', () => {
      setEnv({ chatSecret: `  ${VALID_SECRET}\n`, nodeEnv: 'production' });

      expect(getChatEncryptionSecret()).toBe(VALID_SECRET);
    });

    it('rejects a secret shorter than the minimum, even in production', () => {
      setEnv({ chatSecret: 'a'.repeat(MIN_SECRET_LENGTH - 1), nodeEnv: 'production' });

      expect(() => getChatEncryptionSecret()).toThrow(/at least 32 characters/);
      expect(hasChatEncryptionSecret()).toBe(false);
    });

    it('rejects a short secret outside production too', () => {
      setEnv({ chatSecret: 'short', nodeEnv: 'test' });

      expect(() => getChatEncryptionSecret()).toThrow(/at least 32 characters/);
    });
  });

  describe('in production without CHAT_ENCRYPTION_SECRET', () => {
    it('throws instead of returning a default', () => {
      setEnv({ chatSecret: undefined, nodeEnv: 'production' });

      expect(() => getChatEncryptionSecret()).toThrow(
        /CHAT_ENCRYPTION_SECRET environment variable is required in production/,
      );
      expect(hasChatEncryptionSecret()).toBe(false);
    });

    it('throws for an empty or whitespace-only value', () => {
      setEnv({ chatSecret: '   ', nodeEnv: 'production' });

      expect(() => getChatEncryptionSecret()).toThrow(/required in production/);
    });

    // The core regression: this is the value the old code encrypted with.
    it('never returns the removed public fallback', () => {
      setEnv({ chatSecret: undefined, nodeEnv: 'production' });

      let resolved;
      try {
        resolved = getChatEncryptionSecret();
      } catch (_err) {
        resolved = null;
      }

      expect(resolved).not.toBe(REMOVED_FALLBACK);
    });
  });

  describe('outside production without CHAT_ENCRYPTION_SECRET', () => {
    it('generates a secret instead of using a shared default', () => {
      setEnv({ chatSecret: undefined, nodeEnv: 'development' });

      const secret = getChatEncryptionSecret();

      expect(secret).toBeTruthy();
      expect(secret).not.toBe(REMOVED_FALLBACK);
      expect(secret.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    });

    it('is stable within a process so encryption and decryption agree', () => {
      setEnv({ chatSecret: undefined, nodeEnv: 'development' });

      expect(getChatEncryptionSecret()).toBe(getChatEncryptionSecret());
    });

    it('regenerates after the cache is cleared, simulating a restart', () => {
      setEnv({ chatSecret: undefined, nodeEnv: 'test' });

      const first = getChatEncryptionSecret();
      resetChatEncryptionSecretCache();
      const second = getChatEncryptionSecret();

      expect(second).not.toBe(first);
    });

    it('is long and hex-encoded', () => {
      setEnv({ chatSecret: undefined, nodeEnv: 'test' });

      expect(getChatEncryptionSecret()).toMatch(/^[0-9a-f]{96}$/);
    });
  });

  describe('a configured secret always wins over the fallback', () => {
    it('ignores the cache once CHAT_ENCRYPTION_SECRET is set', () => {
      setEnv({ chatSecret: undefined, nodeEnv: 'test' });
      const generated = getChatEncryptionSecret();

      setEnv({ chatSecret: VALID_SECRET, nodeEnv: 'test' });
      expect(getChatEncryptionSecret()).toBe(VALID_SECRET);
      expect(getChatEncryptionSecret()).not.toBe(generated);
    });
  });
});