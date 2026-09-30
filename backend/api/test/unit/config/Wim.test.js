const assert = require('assert');

describe('WIM Configuration Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test to isolate environment overrides
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should load default configuration values correctly', () => {
    const wimConfig = require('../../../src/config/wim');

    assert.strictEqual(typeof wimConfig.DEFAULT_CREDENTIAL_TTL_MS, 'number');
    assert.strictEqual(typeof wimConfig.DEFAULT_MAX_MEASUREMENT_AGE_MS, 'number');
    assert.strictEqual(typeof wimConfig.MIN_SIGNING_SECRET_LENGTH, 'number');
    
    // Check reasonable default assumptions if specified by standard app settings
    assert.ok(wimConfig.DEFAULT_CREDENTIAL_TTL_MS > 0);
    assert.ok(wimConfig.DEFAULT_MAX_MEASUREMENT_AGE_MS > 0);
  });

  it('should allow environment variable overrides for WIM config', () => {
    process.env.WIM_CREDENTIAL_TTL_MS = '7200000';
    process.env.WIM_MAX_MEASUREMENT_AGE_MS = '300000';
    process.env.MIN_SIGNING_SECRET_LENGTH = '64';

    const wimConfig = require('../../../src/config/wim');

    assert.strictEqual(wimConfig.DEFAULT_CREDENTIAL_TTL_MS, 7200000);
    assert.strictEqual(wimConfig.DEFAULT_MAX_MEASUREMENT_AGE_MS, 300000);
    assert.strictEqual(wimConfig.MIN_SIGNING_SECRET_LENGTH, 64);
  });

  it('should return the expected configuration structure', () => {
    const wimConfig = require('../../../src/config/wim');

    assert.strictEqual(typeof wimConfig, 'object');
    assert.notStrictEqual(wimConfig, null);
    
    // Verify specific keys exist in the exported object
    const keys = Object.keys(wimConfig);
    assert.ok(keys.includes('DEFAULT_CREDENTIAL_TTL_MS'));
    assert.ok(keys.includes('DEFAULT_MAX_MEASUREMENT_AGE_MS'));
    assert.ok(keys.includes('MIN_SIGNING_SECRET_LENGTH'));
  });
});
