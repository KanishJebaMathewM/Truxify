import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getWimSigningSecret,
  hasWimSigningSecret,
  getWimCredentialTtlMs,
  getMaxWimMeasurementAgeMs,
  validateWimConfig,
} from '../../src/config/wim.js';

describe('config/wim getWimSigningSecret', () => {
  const original = process.env.WIM_SIGNING_SECRET;

  beforeEach(() => {
    delete process.env.WIM_SIGNING_SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.WIM_SIGNING_SECRET;
    else process.env.WIM_SIGNING_SECRET = original;
  });

  it('throws when the secret is missing', () => {
    expect(() => getWimSigningSecret()).toThrow(/WIM_SIGNING_SECRET environment variable is required/);
  });

  it('throws when the secret is too short', () => {
    process.env.WIM_SIGNING_SECRET = 'short';
    expect(() => getWimSigningSecret()).toThrow(/at least 32 characters/);
  });

  it('returns the trimmed secret when valid', () => {
    process.env.WIM_SIGNING_SECRET = '  abcdefghijklmnopqrstuvwxyz123456  ';
    expect(getWimSigningSecret()).toBe('abcdefghijklmnopqrstuvwxyz123456');
  });
});

describe('config/wim hasWimSigningSecret', () => {
  const original = process.env.WIM_SIGNING_SECRET;

  beforeEach(() => {
    delete process.env.WIM_SIGNING_SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.WIM_SIGNING_SECRET;
    else process.env.WIM_SIGNING_SECRET = original;
  });

  it('returns false when the secret is missing', () => {
    expect(hasWimSigningSecret()).toBe(false);
  });

  it('returns true when a valid secret is set', () => {
    process.env.WIM_SIGNING_SECRET = 'abcdefghijklmnopqrstuvwxyz123456';
    expect(hasWimSigningSecret()).toBe(true);
  });
});

describe('config/wim TTL helpers', () => {
  const originalTtl = process.env.WIM_CREDENTIAL_TTL_MS;
  const originalAge = process.env.MAX_WIM_MEASUREMENT_AGE_MS;

  beforeEach(() => {
    delete process.env.WIM_CREDENTIAL_TTL_MS;
    delete process.env.MAX_WIM_MEASUREMENT_AGE_MS;
  });

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.WIM_CREDENTIAL_TTL_MS;
    else process.env.WIM_CREDENTIAL_TTL_MS = originalTtl;
    if (originalAge === undefined) delete process.env.MAX_WIM_MEASUREMENT_AGE_MS;
    else process.env.MAX_WIM_MEASUREMENT_AGE_MS = originalAge;
  });

  it('uses the 15-minute defaults when env vars are unset', () => {
    expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
    expect(getMaxWimMeasurementAgeMs()).toBe(15 * 60 * 1000);
  });

  it('honours valid env overrides', () => {
    process.env.WIM_CREDENTIAL_TTL_MS = '60000';
    process.env.MAX_WIM_MEASUREMENT_AGE_MS = '120000';
    expect(getWimCredentialTtlMs()).toBe(60000);
    expect(getMaxWimMeasurementAgeMs()).toBe(120000);
  });

  it('falls back to defaults for invalid env values', () => {
    process.env.WIM_CREDENTIAL_TTL_MS = 'abc';
    process.env.MAX_WIM_MEASUREMENT_AGE_MS = '-5';
    expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
    expect(getMaxWimMeasurementAgeMs()).toBe(15 * 60 * 1000);
  });
});

describe('config/wim validateWimConfig', () => {
  const originalSecret = process.env.WIM_SIGNING_SECRET;
  const originalTtl = process.env.WIM_CREDENTIAL_TTL_MS;
  const originalAge = process.env.MAX_WIM_MEASUREMENT_AGE_MS;

  beforeEach(() => {
    delete process.env.WIM_SIGNING_SECRET;
    delete process.env.WIM_CREDENTIAL_TTL_MS;
    delete process.env.MAX_WIM_MEASUREMENT_AGE_MS;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.WIM_SIGNING_SECRET;
    else process.env.WIM_SIGNING_SECRET = originalSecret;
    if (originalTtl === undefined) delete process.env.WIM_CREDENTIAL_TTL_MS;
    else process.env.WIM_CREDENTIAL_TTL_MS = originalTtl;
    if (originalAge === undefined) delete process.env.MAX_WIM_MEASUREMENT_AGE_MS;
    else process.env.MAX_WIM_MEASUREMENT_AGE_MS = originalAge;
  });

  it('returns the resolved config for a valid environment', () => {
    process.env.WIM_SIGNING_SECRET = 'abcdefghijklmnopqrstuvwxyz123456';
    process.env.WIM_CREDENTIAL_TTL_MS = '60000';
    process.env.MAX_WIM_MEASUREMENT_AGE_MS = '120000';
    expect(validateWimConfig()).toEqual({
      signingSecretConfigured: true,
      credentialTtlMs: 60000,
      maxMeasurementAgeMs: 120000,
    });
  });

  it('throws when the signing secret is missing', () => {
    expect(() => validateWimConfig()).toThrow(/WIM_SIGNING_SECRET/);
  });
});
