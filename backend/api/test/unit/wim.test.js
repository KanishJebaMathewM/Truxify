import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('wim config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('getWimSigningSecret throws when WIM_SIGNING_SECRET is missing', async () => {
    delete process.env.WIM_SIGNING_SECRET;
    const { getWimSigningSecret } = await import('../../../../src/config/wim.js');
    expect(() => getWimSigningSecret()).toThrow('WIM_SIGNING_SECRET environment variable is required');
  });

  it('getWimSigningSecret throws when WIM_SIGNING_SECRET is empty', async () => {
    process.env.WIM_SIGNING_SECRET = '';
    const { getWimSigningSecret } = await import('../../../../src/config/wim.js');
    expect(() => getWimSigningSecret()).toThrow('WIM_SIGNING_SECRET environment variable is required');
  });

  it('getWimSigningSecret throws when secret is too short', async () => {
    process.env.WIM_SIGNING_SECRET = 'tooshort';
    const { getWimSigningSecret } = await import('../../../../src/config/wim.js');
    expect(() => getWimSigningSecret()).toThrow();
  });

  it('getWimSigningSecret returns trimmed secret when valid', async () => {
    process.env.WIM_SIGNING_SECRET = '   a_valid_secret_key_that_is_at_least_32_chars!   ';
    const { getWimSigningSecret } = await import('../../../../src/config/wim.js');
    expect(getWimSigningSecret()).toBe('a_valid_secret_key_that_is_at_least_32_chars!');
  });

  it('getWimCredentialTtlMs returns default when not set', async () => {
    delete process.env.WIM_CREDENTIAL_TTL_MS;
    const { getWimCredentialTtlMs } = await import('../../../../src/config/wim.js');
    expect(getWimCredentialTtlMs()).toBe(15 * 60 * 1000);
  });

  it('getWimCredentialTtlMs returns configured value', async () => {
    process.env.WIM_CREDENTIAL_TTL_MS = '600000';
    const { getWimCredentialTtlMs } = await import('../../../../src/config/wim.js');
    expect(getWimCredentialTtlMs()).toBe(600000);
  });

  it('isWimEnabled returns false when not configured', async () => {
    delete process.env.WIM_ENABLED;
    const { isWimEnabled } = await import('../../../../src/config/wim.js');
    expect(isWimEnabled()).toBe(false);
  });

  it('isWimEnabled returns true when WIM_ENABLED=true', async () => {
    process.env.WIM_ENABLED = 'true';
    const { isWimEnabled } = await import('../../../../src/config/wim.js');
    expect(isWimEnabled()).toBe(true);
  });
});
