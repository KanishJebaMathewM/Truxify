import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  MIN_SECRET_LENGTH,
  getJwtSecret,
  hasJwtSecret,
  resetJwtSecretCache,
} from '../../../src/config/jwtSecret.js';

const VALID_SECRET = 'a'.repeat(MIN_SECRET_LENGTH);
const ORIGINAL_ENV = { ...process.env };

/**
 * The literal that used to be hardcoded in authRoutes.js and auth.js. It is
 * asserted against below because as long as it is present in the repository
 * the vulnerability can be reintroduced by a single careless edit.
 */
const REMOVED_FALLBACK = 'truxify-jwt-secret-key';

function setEnv({ jwtSecret, nodeEnv }) {
  if (jwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = jwtSecret;
  }
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
}

describe('config/jwtSecret', () => {
  beforeEach(() => {
    resetJwtSecretCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetJwtSecretCache();
  });

  describe('with JWT_SECRET configured', () => {
    it('returns the configured secret', () => {
      setEnv({ jwtSecret: VALID_SECRET, nodeEnv: 'production' });

      expect(getJwtSecret()).toBe(VALID_SECRET);
      expect(hasJwtSecret()).toBe(true);
    });

    it('trims surrounding whitespace', () => {
      setEnv({ jwtSecret: `  ${VALID_SECRET}\n`, nodeEnv: 'production' });

      expect(getJwtSecret()).toBe(VALID_SECRET);
    });

    it('rejects a secret shorter than the minimum, even in production', () => {
      setEnv({ jwtSecret: 'a'.repeat(MIN_SECRET_LENGTH - 1), nodeEnv: 'production' });

      expect(() => getJwtSecret()).toThrow(/at least 32 characters/);
      expect(hasJwtSecret()).toBe(false);
    });

    it('rejects a short secret outside production too', () => {
      setEnv({ jwtSecret: 'short', nodeEnv: 'test' });

      // A short key is a weak key regardless of environment; failing closed is
      // the point of the resolver.
      expect(() => getJwtSecret()).toThrow(/at least 32 characters/);
    });
  });

  describe('in production without JWT_SECRET', () => {
    it('throws instead of returning a default', () => {
      setEnv({ jwtSecret: undefined, nodeEnv: 'production' });

      expect(() => getJwtSecret()).toThrow(/JWT_SECRET environment variable is required in production/);
      expect(hasJwtSecret()).toBe(false);
    });

    it('throws for an empty or whitespace-only value', () => {
      setEnv({ jwtSecret: '   ', nodeEnv: 'production' });

      expect(() => getJwtSecret()).toThrow(/required in production/);
    });

    // The core regression: this is the value the old code signed with.
    it('never returns the removed public fallback', () => {
      setEnv({ jwtSecret: undefined, nodeEnv: 'production' });

      let resolved;
      try {
        resolved = getJwtSecret();
      } catch (_err) {
        resolved = null;
      }

      expect(resolved).not.toBe(REMOVED_FALLBACK);
    });
  });

  describe('outside production without JWT_SECRET', () => {
    it('generates a secret instead of using a shared default', () => {
      setEnv({ jwtSecret: undefined, nodeEnv: 'development' });

      const secret = getJwtSecret();

      expect(secret).toBeTruthy();
      expect(secret).not.toBe(REMOVED_FALLBACK);
      expect(secret.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    });

    it('is stable within a process so signing and verification agree', () => {
      setEnv({ jwtSecret: undefined, nodeEnv: 'development' });

      expect(getJwtSecret()).toBe(getJwtSecret());
    });

    it('regenerates after the cache is cleared, simulating a restart', () => {
      setEnv({ jwtSecret: undefined, nodeEnv: 'test' });

      const first = getJwtSecret();
      resetJwtSecretCache();
      const second = getJwtSecret();

      expect(second).not.toBe(first);
    });

    it('is long and hex-encoded', () => {
      setEnv({ jwtSecret: undefined, nodeEnv: 'test' });

      expect(getJwtSecret()).toMatch(/^[0-9a-f]{96}$/);
    });
  });

  describe('a configured secret always wins over the fallback', () => {
    it('ignores the cache once JWT_SECRET is set', () => {
      setEnv({ jwtSecret: undefined, nodeEnv: 'test' });
      const generated = getJwtSecret();

      setEnv({ jwtSecret: VALID_SECRET, nodeEnv: 'test' });
      expect(getJwtSecret()).toBe(VALID_SECRET);
      expect(getJwtSecret()).not.toBe(generated);
    });
  });
});
