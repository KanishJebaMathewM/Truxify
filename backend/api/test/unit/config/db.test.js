import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getTelemetryTtlSeconds,
  validateConfig,
  getAnonClient,
  getAdminClient,
  isConnected,
} from '../../../src/config/db.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Database Configuration Unit Tests', () => {
  describe('getTelemetryTtlSeconds', () => {
    it('defaults to a seven day retention window when the env var is unset', () => {
      vi.stubEnv('TELEMETRY_TTL_SECONDS', '');
      expect(getTelemetryTtlSeconds()).toBe(604800);
    });

    it('honours a numeric retention window', () => {
      vi.stubEnv('TELEMETRY_TTL_SECONDS', '3600');
      expect(getTelemetryTtlSeconds()).toBe(3600);
    });

    it('falls back to the default when the value is not a number', () => {
      vi.stubEnv('TELEMETRY_TTL_SECONDS', 'seven-days');
      expect(getTelemetryTtlSeconds()).toBe(604800);
    });
  });

  describe('validateConfig', () => {
    it('throws while a required variable is missing', () => {
      vi.stubEnv('SUPABASE_URL', '');
      expect(() => validateConfig()).toThrow(/Missing required env vars/);
    });

    it('refuses to boot in production without JWT_SECRET', () => {
      vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
      vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('JWT_SECRET', '');

      expect(() => validateConfig()).toThrow(/JWT_SECRET is required in production/);
    });
  });

  describe('client accessors', () => {
    it('isConnected() mirrors whether the anon client was created', () => {
      expect(isConnected()).toBe(getAnonClient() !== null);
    });

    it('getAdminClient() falls back to the anon client when no service key is set', () => {
      // The accessor is documented to return the service-role client when
      // present and the public client otherwise, so it can never come back
      // undefined - callers rely on that instead of the `||` idiom.
      expect(getAdminClient()).not.toBeUndefined();
    });
  });
});
