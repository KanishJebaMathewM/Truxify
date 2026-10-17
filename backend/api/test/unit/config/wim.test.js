import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getWimSigningSecret,
  hasWimSigningSecret,
  getWimCredentialTtlMs,
  getMaxWimMeasurementAgeMs,
  validateWimConfig,
} from '../../../src/config/wim.js';

describe('wim config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.WIM_SIGNING_SECRET;
    delete process.env.WIM_CREDENTIAL_TTL_MS;
    delete process.env.MAX_WIM_MEASUREMENT_AGE_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('getWimSigningSecret throws when the secret is missing or empty', () => {
    expect(() => getWimSigningSecret()).toThrow(
      'WIM_SIGNING_SECRET environment variable is required'
    );
    process.env.WIM_SIGNING_SECRET = '   ';
    expect(() => getWimSigningSecret()).toThrow(
      'WIM_SIGNING_SECRET environment variable is required'
    );
  });

  it('getWimSigningSecret rejects short secrets and trims valid ones', () => {
    process.env.WIM_SIGNING_SECRET = 'short';
    expect(() => getWimSigningSecret()).toThrow('at least 32 characters');

    const secret = 'a'.repeat(32);
    process.env.WIM_SIGNING_SECRET = `  ${secret}  `;
    expect(getWimSigningSecret()).toBe(secret);
  });

  it('hasWimSigningSecret reflects configuration without throwing', () => {
    expect(hasWimSigningSecret()).toBe(false);
    process.env.WIM_SIGNING_SECRET = 'b'.repeat(40);
    expect(hasWimSigningSecret()).toBe(true);
  });

  it('getWimCredentialTtlMs defaults and honors overrides', () => {
    expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
    process.env.WIM_CREDENTIAL_TTL_MS = '7200000';
    expect(getWimCredentialTtlMs()).toBe(7200000);
    process.env.WIM_CREDENTIAL_TTL_MS = 'nope';
    expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
  });

  it('getMaxWimMeasurementAgeMs defaults and honors overrides', () => {
    expect(getMaxWimMeasurementAgeMs()).toBe(15 * 60 * 1000);
    process.env.MAX_WIM_MEASUREMENT_AGE_MS = '300000';
    expect(getMaxWimMeasurementAgeMs()).toBe(300000);
  });

  it('validateWimConfig fails fast without a secret and reports shape with one', () => {
    expect(() => validateWimConfig()).toThrow();
    process.env.WIM_SIGNING_SECRET = 'c'.repeat(40);
    expect(validateWimConfig()).toEqual({
      signingSecretConfigured: true,
      credentialTtlMs: 15 * 60 * 1000,
      maxMeasurementAgeMs: 15 * 60 * 1000,
    });
  });
});
