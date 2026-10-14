import { keyRepo } from './keyRepository.js';
import { generateSecureApiKey } from '../utils/cryptoUtils.js';
import logger from '../middleware/logger.js';

// Zero-Downtime Key Rotation Automation Engine.
export class KeyRotationService {
  constructor() {
    this.rotationListeners = [];
  }

  onRotation(fn) {
    this.rotationListeners.push(fn);
  }

  /**
   * Gracefully adds a new key while retaining old keys during transition.
   */
  rotateKey(oldKeyId, newKeyConfig) {
    const newKey = generateSecureApiKey();
    const registered = keyRepo.registerKey({
      ...newKeyConfig,
      key: newKey,
    });

    logger.info({ oldKeyId, newKeyId: registered.id }, 'Initiated API key rotation');

    // Notify external services (e.g. AWS Secrets Manager, Vault, Slack)
    this.rotationListeners.forEach((listener) => {
      try {
        listener({ event: 'rotated', oldKeyId, newKeyRecord: registered, rawNewKey: newKey });
      } catch (err) {
        logger.error({ err }, 'Error in key rotation listener callback');
      }
    });

    return { rawNewKey: newKey, record: registered };
  }

  /**
   * Schedule automatic key revocation after grace period (e.g., 24 hours)
   */
  scheduleRevocation(keyId, delayMs = 86400000) {
    logger.info({ keyId, delayMs }, `Key revocation scheduled in ${delayMs / 1000}s`);
    setTimeout(() => {
      const success = keyRepo.revoke(keyId);
      if (success) {
        logger.info({ keyId }, 'Scheduled key revocation completed');
      }
    }, delayMs);
  }
}

export const keyRotationService = new KeyRotationService();