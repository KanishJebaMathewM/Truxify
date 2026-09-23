import { hashApiKey } from '../utils/cryptoUtils.js';
import { keyCache } from './cacheService.js';

/**
 * Enterprise Key Data Store with scoping, metadata, and grace periods.
 */
export class KeyRepository {
  constructor() {
    /** @type {Map<string, Object>} */
    this.keyStore = new Map();
  }

  /**
   * Registers a new key into the repository with metadata.
   */
  registerKey({ id, key, name, scopes = ['*'], rateLimit = 100, expiresAt = null, ipWhitelist = [] }) {
    const hashed = hashApiKey(key);
    const record = {
      id: id || `key_${Date.now()}`,
      hashedKey: hashed,
      name,
      scopes,
      rateLimit,
      expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
      ipWhitelist,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: 'active',
    };

    this.keyStore.set(hashed, record);
    return record;
  }

  /**
   * Load keys from raw environment string.
   */
  loadFromEnv(rawEnvKeys) {
    if (!rawEnvKeys) return;
    const keys = rawEnvKeys.split(',').map((k) => k.trim()).filter(Boolean);
    keys.forEach((key, index) => {
      this.registerKey({
        id: `env_key_${index + 1}`,
        key,
        name: `Environment Key ${index + 1}`,
        scopes: ['*'],
      });
    });
  }

  /**
   * Finds and validates a key record.
   */
  findByRawKey(rawKey) {
    const hashed = hashApiKey(rawKey);
    const cached = keyCache.get(hashed);
    if (cached) return cached;

    const record = this.keyStore.get(hashed);
    if (!record) return null;

    // Check Status and Expiration
    if (record.status !== 'active') return null;
    if (record.expiresAt && Date.now() > record.expiresAt) return null;

    // Cache valid result
    keyCache.set(hashed, record);
    return record;
  }

  touch(hashedKey) {
    const record = this.keyStore.get(hashedKey);
    if (record) {
      record.lastUsedAt = new Date().toISOString();
    }
  }

  revoke(id) {
    for (const [hashed, record] of this.keyStore.entries()) {
      if (record.id === id) {
        record.status = 'revoked';
        keyCache.invalidate(hashed);
        return true;
      }
    }
    return false;
  }
}

export const keyRepo = new KeyRepository();