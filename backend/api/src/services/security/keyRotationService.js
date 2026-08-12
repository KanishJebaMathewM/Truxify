import { ethers } from 'ethers';
import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabaseAdmin } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const ESCROW_ABI = [
  'function transferKeyOwnership(address newKeyAddress, uint256 nonce) external',
  'function verifyKeyOwnership(address keyAddress) view returns (bool)',
];

function sanitizeErrorMessage(message, secrets = []) {
  let safe = typeof message === 'string' ? message : String(message);
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    safe = safe.split(String(secret)).join('[REDACTED]');
  }
  return safe;
}

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

      const { data, error } = await supabaseAdmin
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
      const { error } = await supabaseAdmin
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

        if (!this.isValidPrivateKey(oldPrivateKey) || !this.isValidPrivateKey(newPrivateKey)) {
          throw new Error('Invalid private key format');
        }

        // Derive the new wallet's public address from the private key. The
        // raw private key must never be encoded into calldata or persisted —
        // only the public address leaves the key-management boundary.
        let newAddress;
        try {
          newAddress = new ethers.Wallet(newPrivateKey).address;
        } catch (walletErr) {
          throw new Error('Invalid new private key: could not derive wallet address', { cause: walletErr });
        }

        const signer = new ethers.Wallet(oldPrivateKey, this.provider);
        // Derive public addresses — private keys must never leave this boundary.
        const oldWallet = new ethers.Wallet(oldPrivateKey, this.provider);
        const newWalletAddress = new ethers.Wallet(newPrivateKey).address;

        // Verify contract interface expects (address, uint256) — never pass raw key.
        const tx = await oldWallet.sendTransaction({
          to: this.escrowContract.target,
          data: this.escrowContract.interface.encodeFunctionData('transferKeyOwnership', [
            newWalletAddress,  // public address only — never the private key
            Date.now(),
          ]),
        });

        const receipt = await tx.wait();

        // Receipt-row persistence is best-effort: the on-chain transfer has
        // already committed, so a failed audit write must not surface as a
        // transfer failure or trigger a duplicate re-transfer on retry.
        // Only non-sensitive metadata is persisted — public addresses and
        // transaction details. Private-key material is never stored.
        // Persist only non-sensitive audit metadata — no key material of any kind.
        try {
          const { error: insertError } = await supabaseAdmin
            .from('key_ownership_transfers')
            .insert([{
              old_wallet_address: oldWallet.address,   // public address only
              new_wallet_address: newWalletAddress,     // public address only
              wallet_address: walletAddress,
              tx_hash: receipt.hash,
              block_number: receipt.blockNumber,
              completed_at: new Date().toISOString(),
            }]);

          if (insertError) {
            logger.error('[KeyRotationService] Failed to record on-chain ownership transfer receipt:', insertError.message);
          }
        } catch (insertErr) {
          logger.error('[KeyRotationService] Failed to record on-chain ownership transfer receipt:', insertErr.message);
        }

        logger.info('[KeyRotationService] On-chain key ownership transfer completed:', receipt.hash);

        return {
          status: 'success',
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
        };
      } catch (err) {
        const safeMessage = sanitizeErrorMessage(err && err.message, [oldPrivateKey, newPrivateKey]);
        logger.error('[KeyRotationService] On-chain transfer failed:', safeMessage);
        Sentry.captureException(new Error('On-chain transfer failed: ' + safeMessage, { cause: err }));
        throw new Error('On-chain key ownership transfer failed: ' + safeMessage, { cause: err });
      }
    });
  }

  isValidPrivateKey(privateKey) {
    if (this.keyManagementService && typeof this.keyManagementService.validatePrivateKey === 'function') {
      return this.keyManagementService.validatePrivateKey(privateKey);
    }
    if (!privateKey || typeof privateKey !== 'string') {
      return false;
    }
    return /^0x[a-fA-F0-9]{64}$/.test(privateKey) || /^[a-fA-F0-9]{64}$/.test(privateKey);
  }

  async getRotationHistory(userId, walletAddress, limit = 10) {
    try {
      const { data: history, error } = await supabaseAdmin
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
      await supabaseAdmin
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
      const wallets = await supabaseAdmin
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
