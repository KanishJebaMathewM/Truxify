/**
 * WIM bypass configuration.
 *
 * Centralizes every security-relevant WIM setting so the route and service
 * never read process.env directly and never fall back to a hardcoded secret.
 *
 * Fail-closed contract:
 *   - WIM_SIGNING_SECRET must be set and at least MIN_SIGNING_SECRET_LENGTH
 *     characters long. No development/test fallback is ever applied; if the
 *     secret is missing, empty or too short, getWimSigningSecret() throws and
 *     no bypass credential is signed.
 *   - WIM_CREDENTIAL_TTL_MS bounds the lifetime of every issued credential
 *     (server-controlled, never client-supplied).
 *   - MAX_WIM_MEASUREMENT_AGE_MS bounds how old a trusted measurement may be
 *     before it is considered stale and rejected.
 */

const DEFAULT_CREDENTIAL_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_MEASUREMENT_AGE_MS = 15 * 60 * 1000; // 15 minutes
const MIN_SIGNING_SECRET_LENGTH = 32;

/**
 * Returns the configured WIM signing secret or throws.
 *
 * The secret is read lazily so configuration failures surface as fail-closed
 * signing errors at request time even when the startup validation was skipped.
 *
 * @returns {string} The trimmed signing secret.
 * @throws {Error} If the secret is missing, empty or too short.
 */
export function getWimSigningSecret() {
  const raw = process.env.WIM_SIGNING_SECRET;
  const secret = typeof raw === 'string' ? raw.trim() : '';
  if (!secret) {
    throw new Error(
      'WIM_SIGNING_SECRET environment variable is required to sign WIM bypass packets.',
    );
  }
  if (secret.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new Error(
      `WIM_SIGNING_SECRET must be at least ${MIN_SIGNING_SECRET_LENGTH} characters long.`,
    );
  }
  return secret;
}

/**
 * Returns true when a usable WIM signing secret is configured.
 * @returns {boolean}
 */
export function hasWimSigningSecret() {
  try {
    getWimSigningSecret();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Server-controlled lifetime of an issued bypass credential.
 * @returns {number} Milliseconds.
 */
export function getWimCredentialTtlMs() {
  const parsed = Number(process.env.WIM_CREDENTIAL_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CREDENTIAL_TTL_MS;
}

/**
 * Maximum acceptable age of a trusted WIM measurement.
 * @returns {number} Milliseconds.
 */
export function getMaxWimMeasurementAgeMs() {
  const parsed = Number(process.env.MAX_WIM_MEASUREMENT_AGE_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_MEASUREMENT_AGE_MS;
}

/**
 * Startup validation for WIM signing configuration. Throws when the system
 * cannot issue credentials safely, so the process fails fast instead of
 * silently serving unsigned or weakly-signed bypass packets.
 *
 * @returns {{ signingSecretConfigured: boolean, credentialTtlMs: number, maxMeasurementAgeMs: number }}
 * @throws {Error} On missing/invalid configuration.
 */
export function validateWimConfig() {
  getWimSigningSecret();

  const credentialTtlMs = getWimCredentialTtlMs();
  const maxMeasurementAgeMs = getMaxWimMeasurementAgeMs();

  if (credentialTtlMs <= 0 || maxMeasurementAgeMs <= 0) {
    throw new Error(
      'WIM_CREDENTIAL_TTL_MS and MAX_WIM_MEASUREMENT_AGE_MS must be positive integers.',
    );
  }

  return {
    signingSecretConfigured: true,
    credentialTtlMs,
    maxMeasurementAgeMs,
  };
}
