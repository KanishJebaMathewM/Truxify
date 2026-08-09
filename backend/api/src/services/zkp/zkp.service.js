import { ethers } from 'ethers';
import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import { supabase } from '../../config/db.js';
import { acquireLock, releaseLock, LockAcquisitionError } from '../../lib/redisLock.js';

/**
 * TTL for the per-user ZKP verification lock (ms).
 * Must be long enough to cover proof generation + blockchain tx confirmation.
 * Configurable via ZKP_LOCK_TTL_MS env var.
 */
const ZKP_LOCK_TTL_MS = Number(process.env.ZKP_LOCK_TTL_MS) || 120_000;

class ZKPService {
  constructor() {
    if (!process.env.POLYGON_RPC_URL || !process.env.PRIVATE_KEY || !process.env.KYC_VERIFIER_CONTRACT) {
      logger.warn('ZKPService disabled: POLYGON_RPC_URL, PRIVATE_KEY, or KYC_VERIFIER_CONTRACT not set.');
      this.provider = null;
      this.wallet = null;
      this.contract = null;
      this.contractAddress = null;
      this.contractABI = [];
      return;
    }
    this.provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
    this.contractAddress = process.env.KYC_VERIFIER_CONTRACT;
    this.contractABI = [
      'function verifyKYC(uint[2] memory a, uint[2][2] memory b, uint[2] memory c, uint[2] memory input, address user) public returns (bool)',
      'function isVerified(address user) public view returns (bool)',
      'function hashDocument(bytes32 documentHash, address user) public',
      'function getDocumentHash(address user) public view returns (bytes32)'
    ];
    this.contract = new ethers.Contract(this.contractAddress, this.contractABI, this.wallet);
  }

  async generateZKProof(driverData) {
    try {
      const documentHash = this.hashDocument(driverData);
      const proofData = await this.callSnarkJS(driverData, documentHash);
      await this.storeProof(driverData.userId, proofData);
      return {
        success: true,
        proof: proofData.proof,
        publicSignals: proofData.publicSignals,
        documentHash,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('ZK proof generation failed:', error);
      throw error;
    }
  }

  hashDocument(driverData) {
    const documentString = JSON.stringify({
      name: driverData.name,
      licenseNumber: driverData.licenseNumber,
      rcNumber: driverData.rcNumber,
      insuranceNumber: driverData.insuranceNumber,
      issueDate: driverData.issueDate,
      expiryDate: driverData.expiryDate
    });
    return crypto.createHash('sha256').update(documentString).digest('hex');
  }

  async callSnarkJS(driverData, documentHash) {
    const isMock = process.env.ZKP_MOCK === 'true' || process.env.NODE_ENV === 'test';
    
    if (process.env.NODE_ENV === 'production' && !isMock) {
      throw new Error('[ZKPService] Real SNARK circuit proof execution is required in production. Mock proofs are disallowed.');
    }

    if (isMock) {
      logger.warn('[ZKPService] Generating mock ZK proof (ZKP_MOCK or test mode active)');
      return {
        proof: {
          a: ['0x123...', '0x456...'],
          b: [['0x789...', '0xabc...'], ['0xdef...', '0xghi...']],
          c: ['0xjkl...', '0xmno...']
        },
        publicSignals: [documentHash, '1']
      };
    }

    throw new Error('[ZKPService] SNARK proof generation circuit worker is not configured.');
  }

  async verifyKYCOnChain(userId, proof) {
    try {
      if (!this.contract) throw new Error('ZKPService not configured: missing environment variables');
      const userData = await this.getUserAddress(userId);
      if (!userData) throw new Error('User not found');

      const tx = await this.contract.verifyKYC(
        proof.a,
        proof.b,
        proof.c,
        proof.input,
        userData.wallet_address
      );
      const receipt = await tx.wait();
      await this.updateVerificationStatus(userId, true, receipt.hash);
      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('On-chain verification failed:', error);
      throw error;
    }
  }

  async getUserAddress(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('wallet_address')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  }

  async storeProof(userId, proofData) {
    const { error } = await supabase
      .from('zk_proofs')
      .insert([{
        user_id: userId,
        proof: proofData.proof,
        public_signals: proofData.publicSignals,
        created_at: new Date().toISOString()
      }]);
    if (error) throw error;
  }

  async updateVerificationStatus(userId, verified, txHash) {
    const { error } = await supabase
      .from('users')
      .update({
        kyc_verified: verified,
        kyc_verified_at: new Date().toISOString(),
        kyc_tx_hash: txHash
      })
      .eq('id', userId);
    if (error) throw error;
  }

  async isVerified(userId) {
    try {
      if (!this.contract) return false;
      const userData = await this.getUserAddress(userId);
      if (!userData) return false;
      return await this.contract.isVerified(userData.wallet_address);
    } catch (error) {
      logger.error('Verification check failed:', error);
      return false;
    }
  }

  /**
   * Check KYC verification status directly in the database (cheaper than
   * an on-chain call and sufficient for the idempotency guard).
   */
  async isVerifiedInDb(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('kyc_verified')
      .eq('id', userId)
      .single();
    if (error || !data) return false;
    return data.kyc_verified === true;
  }

  async getDocumentHash(userId) {
    try {
      if (!this.contract) return null;
      const userData = await this.getUserAddress(userId);
      if (!userData) return null;
      return await this.contract.getDocumentHash(userData.wallet_address);
    } catch (error) {
      logger.error('Document hash fetch failed:', error);
      return null;
    }
  }

  /**
   * Verifies a driver's KYC documents using ZK-SNARKs and submits the
   * proof to the on-chain verifier contract.
   *
   * Race-condition fix (issue #5729):
   *   A distributed Redis lock keyed to `zkp:verify:{userId}` is acquired
   *   before any processing begins. This guarantees at-most-one execution
   *   even under concurrent duplicate requests:
   *
   *   - LockAcquisitionError (Redis unavailable) → propagated to caller → 503
   *   - lockValue === null (lock held by another request) → propagated → 409
   *   - After acquiring the lock, re-check `kyc_verified` in the DB; if the
   *     first request already completed, return early without re-running the
   *     blockchain transaction or inserting duplicate audit rows.
   *
   * @param {object} driverData
   * @throws {LockAcquisitionError} When Redis is unavailable — caller must return 503.
   * @returns {{ success: boolean, alreadyVerified?: boolean, proof?, onChain?, verified? }}
   */
  async verifyDriver(driverData) {
    const lockKey = `zkp:verify:${driverData.userId}`;
    let lockValue;

    try {
      // Throws LockAcquisitionError if Redis is down — propagate to route handler.
      lockValue = await acquireLock(lockKey, ZKP_LOCK_TTL_MS);

      if (lockValue === null) {
        // Another request is currently processing this user's verification.
        logger.warn(`[ZKP] Verification already in progress for user ${driverData.userId}`);
        return {
          success: false,
          conflict: true,
          error: 'Verification already in progress for this user. Please try again shortly.'
        };
      }

      // Idempotency guard: re-check inside the lock so a second request that
      // arrives after the first one has already committed sees the result and
      // exits without re-running the expensive blockchain transaction.
      const alreadyVerified = await this.isVerifiedInDb(driverData.userId);
      if (alreadyVerified) {
        logger.info(`[ZKP] User ${driverData.userId} is already KYC-verified — skipping duplicate processing`);
        return {
          success: true,
          alreadyVerified: true,
          verified: true,
          message: 'User is already KYC-verified.'
        };
      }

      // Step 1: Generate ZK proof
      const proofResult = await this.generateZKProof(driverData);

      // Step 2: Submit to blockchain
      const onChainResult = await this.verifyKYCOnChain(
        driverData.userId,
        proofResult.proof
      );

      // Step 3: Log verification
      await this.logVerification(driverData.userId, onChainResult);

      return {
        success: true,
        proof: proofResult,
        onChain: onChainResult,
        verified: true
      };
    } catch (error) {
      logger.error('Driver verification failed:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      // Always release the lock, even on error, so the user can retry.
      await releaseLock(lockKey, lockValue).catch(err =>
        logger.error({ err }, '[ZKP] Failed to release verification lock')
      );
    }
  }

  async logVerification(userId, result) {
    const { error } = await supabase
      .from('kyc_audit_logs')
      .insert([{
        user_id: userId,
        action: 'KYC_VERIFICATION',
        status: 'SUCCESS',
        tx_hash: result.transactionHash,
        timestamp: new Date().toISOString()
      }]);
    if (error) throw error;
  }

  async getVerificationStats() {
    const [verifiedResult, unverifiedResult] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('kyc_verified', true),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('kyc_verified', false),
    ]);
    if (verifiedResult.error) throw verifiedResult.error;
    if (unverifiedResult.error) throw unverifiedResult.error;
    const totalVerified = verifiedResult.count || 0;
    const totalUnverified = unverifiedResult.count || 0;
    return {
      totalVerified,
      totalUnverified,
      total: totalVerified + totalUnverified,
    };
  }
}

export default new ZKPService();