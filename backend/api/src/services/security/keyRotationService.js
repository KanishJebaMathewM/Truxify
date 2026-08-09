import { ethers } from 'ethers';
import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const ESCROW_ABI = [
  'function transferKeyOwnership(address newKeyAddress, uint256 nonce) external',
  'function verifyKeyOwnership(address keyAddress) view returns (bool)',
];

class KeyRotationService {
  constructor(deps = {}) {
    this.keyManagementService = deps.keyManagementService;
    this.provider = deps.provider;
    this.escrowContract = deps.escrowContract;
    this.rotationLocks = new Set();
  }

  async initiateKeyRotation(userId, walletAddress, currentPrivateKey, newPrivateKey, reason = 'routine') {
    return measureExecution('KeyRotationService.initiateKeyRotation', async () => {
      const lockKey = `${userId}:${walletAddress}`;

      if (this.rotationLocks.has(lockKey)) {
        throw new Error('Key rotation already in progress');
      }

      this.rotationLocks.add(lockKey);

      try {
        logger.info('[KeyRotationService] Starting key rotation for:', walletAddress, 'Reason:', reason);

        if (!this.keyManagementService.validatePrivateKey(currentPrivateKey) ||
            !this.keyManagementService.validatePrivateKey(newPrivateKey)) {
          throw new Error('Invalid private key format');
        }

        const rotationId = await this.createRotationRecord(userId, walletAddress, reason);

        await this.archiveCurrentKey(userId, walletAddress, reason);

        const newKeyId = await this.storeNewKey(userId, walletAddress, newPrivateKey);

        await this.updateRotationRecord(rotationId, {
          status: 'completed',
          new_key_id: newKeyId,
          completed_at: new Date().toISOString(),
        });

        await this.logKeyRotationEvent(userId, walletAddress, reason, 'success');

        logger.info('[KeyRotationService] Key rotation completed:', rotationId);

        this.rotationLocks.delete(lockKey);

        return {
          rotationId,
          status: 'success',
          message: 'Key rotated successfully',
        };
      } catch (err) {
        logger.error('[KeyRotationService] Key rotation failed:', err.message);
        Sentry.captureException(err);

        await this.logKeyRotationEvent(userId, walletAddress, reason, 'failed', err.message);

        this.rotationLocks.delete(lockKey);

        throw new Error('Key rotation failed: ' + err.message, { cause: err });
      }
    });
  }

  async createRotationRecord(userId, walletAddress, reason) {
    try {
      const rotationId = `rot_${crypto.randomUUID()}`;

      const { data, error } = await supabase
        .from('key_rotations')
        .insert([{
          rotation_id: rotationId,
          user_id: userId,
          wallet_address: walletAddress,
          reason,
          status: 'in_progress',
          initiated_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) {
        logger.error('[KeyRotationService] Failed to create rotation record:', error);
        throw error;
      }

      return rotationId;
    } catch (err) {
      logger.error('[KeyRotationService] Rotation record creation failed:', err.message);
      throw err;
    }
  }

  async updateRotationRecord(rotationId, updates) {
    try {
      const { error } = await supabase
        .from('key_rotations')
        .update(updates)
        .eq('rotation_id', rotationId);

      if (error) {
        logger.error('[KeyRotationService] Failed to update rotation record:', error);
        throw error;
      }
    } catch (err) {
      logger.error('[KeyRotationService] Rotation record update failed:', err.message);
    }
  }

  async archiveCurrentKey(userId, walletAddress, reason) {
    try {
      const currentKey = await this.keyManagementService.retrieveEncryptedKey(userId, walletAddress);

      if (currentKey) {
        await this.keyManagementService.archiveKey(currentKey.key_id, `rotation_reason_${reason}`);
        logger.info('[KeyRotationService] Current key archived:', currentKey.key_id);
      }
    } catch (err) {
      logger.error('[KeyRotationService] Failed to archive current key:', err.message);
      throw err;
    }
  }

  async storeNewKey(userId, walletAddress, newPrivateKey) {
    try {
      const masterSecret = this.keyManagementService.generateMasterSecret();
      const deviceId = process.env.SERVER_DEVICE_ID || 'server-backend';

      const encryptedData = await this.keyManagementService.encryptPrivateKey(
        newPrivateKey,
        deviceId,
        masterSecret
      );

      const keyId = await this.keyManagementService.storeEncryptedKey(
        userId,
        walletAddress,
        encryptedData,
        deviceId,
        2
      );

      logger.info('[KeyRotationService] New key stored:', keyId);
      return keyId;
    } catch (err) {
      logger.error('[KeyRotationService] Failed to store new key:', err.message);
      throw err;
    }
  }

  async transferKeyOwnershipOnChain(userId, walletAddress, oldPrivateKey, newPrivateKey) {
    return measureExecution('KeyRotationService.transferKeyOwnershipOnChain', async () => {
      try {
        if (!this.escrowContract) {
          logger.warn('[KeyRotationService] Escrow contract not available for on-chain transfer');
          return { status: 'skipped', reason: 'contract_unavailable' };
        }

        const signer = new ethers.Wallet(oldPrivateKey, this.provider);

        const tx = await signer.sendTransaction({
          to: this.escrowContract.target,
          data: this.escrowContract.interface.encodeFunctionData('transferKeyOwnership', [
            walletAddress,
            Date.now(),
          ]),
        });

        const receipt = await tx.wait();

        await supabase
          .from('key_ownership_transfers')
          .insert([{
            old_key: oldPrivateKey.slice(0, 10) + '...',
            new_key: newPrivateKey.slice(0, 10) + '...',
            wallet_address: walletAddress,
            tx_hash: receipt.hash,
            block_number: receipt.blockNumber,
            completed_at: new Date().toISOString(),
          }]);

        logger.info('[KeyRotationService] On-chain key ownership transfer completed:', receipt.hash);

        return {
          status: 'success',
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
        };
      } catch (err) {
        logger.error('[KeyRotationService] On-chain transfer failed:', err.message);
        Sentry.captureException(err);
        throw err;
      }
    });
  }

  async getRotationHistory(userId, walletAddress, limit = 10) {
    try {
      const { data: history, error } = await supabase
        .from('key_rotations')
        .select('*')
        .eq('user_id', userId)
        .eq('wallet_address', walletAddress)
        .order('initiated_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error('[KeyRotationService] Failed to fetch rotation history:', error);
        return [];
      }

      return history || [];
    } catch (err) {
      logger.error('[KeyRotationService] Rotation history retrieval failed:', err.message);
      return [];
    }
  }

  async logKeyRotationEvent(userId, walletAddress, reason, status, errorMessage = null) {
    try {
      await supabase
        .from('key_rotation_audit_log')
        .insert([{
          user_id: userId,
          wallet_address: walletAddress,
          reason,
          status,
          error_message: errorMessage,
          timestamp: new Date().toISOString(),
          ip_address: process.env.REQUEST_IP || 'unknown',
        }]);
    } catch (err) {
      logger.error('[KeyRotationService] Failed to log rotation event:', err.message);
    }
  }

  async enforceKeyRotationPolicy(userId, daysSinceLastRotation = 90) {
    try {
      const wallets = await supabase
        .from('profiles')
        .select('polygon_wallet_address')
        .eq('id', userId);

      if (!wallets.data || wallets.data.length === 0) {
        return { requiresRotation: false };
      }

      for (const wallet of wallets.data) {
        const history = await this.getRotationHistory(userId, wallet.polygon_wallet_address, 1);

        if (history.length === 0) {
          return { requiresRotation: true, walletAddress: wallet.polygon_wallet_address, reason: 'no_rotation_history' };
        }

        const lastRotation = new Date(history[0].initiated_at);
        const daysSinceRotation = (Date.now() - lastRotation.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceRotation > daysSinceLastRotation) {
          return { requiresRotation: true, walletAddress: wallet.polygon_wallet_address, reason: 'policy_expired', daysSinceRotation };
        }
      }

      return { requiresRotation: false };
    } catch (err) {
      logger.error('[KeyRotationService] Policy enforcement check failed:', err.message);
      return { requiresRotation: false, error: err.message };
    }
  }
}

export default KeyRotationService;
