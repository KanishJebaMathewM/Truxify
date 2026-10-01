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
