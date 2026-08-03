import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;

class KeyManagementService {
  constructor() {
    this.encryptionKeyCache = new Map();
  }

  async deriveDeviceEncryptionKey(deviceId, masterSecret) {
    return measureExecution('KeyManagementService.deriveDeviceEncryptionKey', async () => {
      const cacheKey = `${deviceId}:${masterSecret.slice(0, 8)}`;

      if (this.encryptionKeyCache.has(cacheKey)) {
        return this.encryptionKeyCache.get(cacheKey);
      }

      const derivedKey = crypto.pbkdf2Sync(
        Buffer.concat([
          Buffer.from(deviceId),
          Buffer.from(masterSecret),
        ]),
        Buffer.from('truxify-wallet-key-derivation'),
        100000,
        32,
        'sha256'
      );

      this.encryptionKeyCache.set(cacheKey, derivedKey);

      setTimeout(() => {
        this.encryptionKeyCache.delete(cacheKey);
      }, 60000);

      return derivedKey;
    });
  }

  async encryptPrivateKey(privateKey, deviceId, masterSecret) {
    return measureExecution('KeyManagementService.encryptPrivateKey', async () => {
      try {
        const deviceKey = await this.deriveDeviceEncryptionKey(deviceId, masterSecret);

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, deviceKey, iv);

        let encrypted = cipher.update(privateKey, 'utf-8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();
        const salt = crypto.randomBytes(SALT_LENGTH);

        const encryptedData = {
          iv: iv.toString('hex'),
          encryptedKey: encrypted,
          authTag: authTag.toString('hex'),
          salt: salt.toString('hex'),
          algorithm: ALGORITHM,
          timestamp: new Date().toISOString(),
        };

        logger.info('[KeyManagementService] Private key encrypted for device:', deviceId);
        return encryptedData;
      } catch (err) {
        logger.error('[KeyManagementService] Encryption failed:', err.message);
        Sentry.captureException(err);
        throw new Error('Failed to encrypt private key', { cause: err });
      }
    });
  }

  async decryptPrivateKey(encryptedData, deviceId, masterSecret) {
    return measureExecution('KeyManagementService.decryptPrivateKey', async () => {
      try {
        const deviceKey = await this.deriveDeviceEncryptionKey(deviceId, masterSecret);

        const iv = Buffer.from(encryptedData.iv, 'hex');
        const encryptedKey = Buffer.from(encryptedData.encryptedKey, 'hex');
        const authTag = Buffer.from(encryptedData.authTag, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, deviceKey, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedKey, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');

        logger.info('[KeyManagementService] Private key decrypted for device:', deviceId);
        return decrypted;
      } catch (err) {
        logger.error('[KeyManagementService] Decryption failed:', err.message);
        Sentry.captureException(err);
        throw new Error('Failed to decrypt private key', { cause: err });
      }
    });
  }

  async storeEncryptedKey(userId, walletAddress, encryptedKeyData, deviceId, version = 1) {
    return measureExecution('KeyManagementService.storeEncryptedKey', async () => {
      try {
        const keyId = crypto.randomUUID();

        const { data, error } = await supabase
          .from('encrypted_wallet_keys')
          .insert([{
            key_id: keyId,
            user_id: userId,
            wallet_address: walletAddress,
            encrypted_key: encryptedKeyData,
            device_id: deviceId,
            version,
            active: true,
            created_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
          }]);

        if (error) {
          logger.error('[KeyManagementService] Failed to store key:', error);
          throw error;
        }

        logger.info('[KeyManagementService] Encrypted key stored:', keyId);
        return keyId;
      } catch (err) {
        logger.error('[KeyManagementService] Key storage failed:', err.message);
        Sentry.captureException(err);
        throw new Error('Failed to store encrypted key', { cause: err });
      }
    });
  }

  async retrieveEncryptedKey(userId, walletAddress) {
    return measureExecution('KeyManagementService.retrieveEncryptedKey', async () => {
      try {
        const { data: keys, error } = await supabase
          .from('encrypted_wallet_keys')
          .select('*')
          .eq('user_id', userId)
          .eq('wallet_address', walletAddress)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error) {
          logger.warn('[KeyManagementService] No active key found:', error);
          return null;
        }

        await supabase
          .from('encrypted_wallet_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('key_id', keys.key_id);

        logger.info('[KeyManagementService] Encrypted key retrieved:', keys.key_id);
        return keys;
      } catch (err) {
        logger.error('[KeyManagementService] Key retrieval failed:', err.message);
        return null;
      }
    });
  }

  async archiveKey(keyId, reason = 'unknown') {
    return measureExecution('KeyManagementService.archiveKey', async () => {
      try {
        const { error } = await supabase
          .from('encrypted_wallet_keys')
          .update({
            active: false,
            archived_at: new Date().toISOString(),
            archive_reason: reason,
          })
          .eq('key_id', keyId);

        if (error) {
          logger.error('[KeyManagementService] Failed to archive key:', error);
          throw error;
        }

        logger.info('[KeyManagementService] Key archived:', keyId, 'Reason:', reason);
        return true;
      } catch (err) {
        logger.error('[KeyManagementService] Key archival failed:', err.message);
        Sentry.captureException(err);
        throw new Error('Failed to archive key', { cause: err });
      }
    });
  }

  async getKeyRotationHistory(userId, walletAddress) {
    return measureExecution('KeyManagementService.getKeyRotationHistory', async () => {
      try {
        const { data: history, error } = await supabase
          .from('encrypted_wallet_keys')
          .select('*')
          .eq('user_id', userId)
          .eq('wallet_address', walletAddress)
          .order('created_at', { ascending: false });

        if (error) {
          logger.error('[KeyManagementService] Failed to fetch rotation history:', error);
          return [];
        }

        return history || [];
      } catch (err) {
        logger.error('[KeyManagementService] Rotation history retrieval failed:', err.message);
        return [];
      }
    });
  }

  clearEncryptionKeyCache() {
    this.encryptionKeyCache.clear();
    logger.info('[KeyManagementService] Encryption key cache cleared');
  }

  generateMasterSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  validatePrivateKey(privateKey) {
    try {
      if (!privateKey || typeof privateKey !== 'string') {
        return false;
      }

      if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey) && !/^[a-fA-F0-9]{64}$/.test(privateKey)) {
        return false;
      }

      return true;
    } catch (err) {
      return false;
    }
  }
}

export default KeyManagementService;
