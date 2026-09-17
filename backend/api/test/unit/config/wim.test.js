import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  getWimSigningSecret,
  hasWimSigningSecret,
  getWimCredentialTtlMs,
  getMaxWimMeasurementAgeMs,
  validateWimConfig,
} = await import('../../../src/config/wim.js');

describe('wim.js config', () => {
  const originalSecret = process.env.WIM_SIGNING_SECRET;
  const originalTtl = process.env.WIM_CREDENTIAL_TTL_MS;
  const originalAge = process.env.MAX_WIM_MEASUREMENT_AGE_MS;

  beforeEach(() => {
    delete process.env.WIM_SIGNING_SECRET;
    delete process.env.WIM_CREDENTIAL_TTL_MS;
    delete process.env.MAX_WIM_MEASUREMENT_AGE_MS;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.WIM_SIGNING_SECRET;
    else process.env.WIM_SIGNING_SECRET = originalSecret;

    if (originalTtl === undefined) delete process.env.WIM_CREDENTIAL_TTL_MS;
    else process.env.WIM_CREDENTIAL_TTL_MS = originalTtl;

    if (originalAge === undefined) delete process.env.MAX_WIM_MEASUREMENT_AGE_MS;
    else process.env.MAX_WIM_MEASUREMENT_AGE_MS = originalAge;
  });

  describe('getWimSigningSecret', () => {
    it('throws when WIM_SIGNING_SECRET is not set', () => {
      expect(() => getWimSigningSecret()).toThrow(/WIM_SIGNING_SECRET/);
    });

    it('throws when WIM_SIGNING_SECRET is empty', () => {
      process.env.WIM_SIGNING_SECRET = '';
      expect(() => getWimSigningSecret()).toThrow(/WIM_SIGNING_SECRET/);
    });

    it('throws when WIM_SIGNING_SECRET is too short', () => {
      process.env.WIM_SIGNING_SECRET = 'tooshort';
      expect(() => getWimSigningSecret()).toThrow(/32/);
    });

    it('returns trimmed value when valid', () => {
      // 8 spaces + 32-char secret + 8 spaces = 48 chars total, > 32 so valid
      process.env.WIM_SIGNING_SECRET = '        ' + 'a'.repeat(32) + '        ';
      expect(getWimSigningSecret()).toBe('a'.repeat(32));
    });

    it('returns exact value when valid and no whitespace', () => {
      const secret = 'a'.repeat(32);
      process.env.WIM_SIGNING_SECRET = secret;
      expect(getWimSigningSecret()).toBe(secret);
    });
  });

  describe('hasWimSigningSecret', () => {
    it('returns false when WIM_SIGNING_SECRET is missing', () => {
      expect(hasWimSigningSecret()).toBe(false);
    });

    it('returns false when WIM_SIGNING_SECRET is too short', () => {
      process.env.WIM_SIGNING_SECRET = 'tooshort';
      expect(hasWimSigningSecret()).toBe(false);
    });

    it('returns true when WIM_SIGNING_SECRET is valid', () => {
      process.env.WIM_SIGNING_SECRET = 'a'.repeat(32);
      expect(hasWimSigningSecret()).toBe(true);
    });
  });

  describe('getWimCredentialTtlMs', () => {
    it('returns default when env is not set', () => {
      expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
    });

    it('returns default when env is not a number', () => {
      process.env.WIM_CREDENTIAL_TTL_MS = 'abc';
      expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
    });

    it('returns default when env is negative', () => {
      process.env.WIM_CREDENTIAL_TTL_MS = '-100';
      expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
    });

    it('returns default when env is zero', () => {
      process.env.WIM_CREDENTIAL_TTL_MS = '0';
      expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
    });

    it('returns parsed value when positive finite number', () => {
      process.env.WIM_CREDENTIAL_TTL_MS = '600000';
      expect(getWimCredentialTtlMs()).toBe(600000);
    });
  });

  describe('getMaxWimMeasurementAgeMs', () => {
    it('returns default when env is not set', () => {
      expect(getMaxWimMeasurementAgeMs()).toBe(15 * 60 * 1000);
    });

    it('returns default when env is not a number', () => {
      process.env.MAX_WIM_MEASUREMENT_AGE_MS = 'xyz';
      expect(getMaxWimMeasurementAgeMs()).toBe(15 * 60 * 1000);
    });

    it('returns parsed value when positive finite number', () => {
      process.env.MAX_WIM_MEASUREMENT_AGE_MS = '300000';
      expect(getMaxWimMeasurementAgeMs()).toBe(300000);
    });
  });

  describe('validateWimConfig', () => {
    it('throws when WIM_SIGNING_SECRET is missing', () => {
      expect(() => validateWimConfig()).toThrow(/WIM_SIGNING_SECRET/);
    });

    it('returns config object when valid', () => {
      process.env.WIM_SIGNING_SECRET = 'a'.repeat(32);
      process.env.WIM_CREDENTIAL_TTL_MS = '900000';
      process.env.MAX_WIM_MEASUREMENT_AGE_MS = '900000';
      const config = validateWimConfig();
      expect(config.signingSecretConfigured).toBe(true);
      expect(config.credentialTtlMs).toBe(900000);
      expect(config.maxMeasurementAgeMs).toBe(900000);
    });
  });
});
