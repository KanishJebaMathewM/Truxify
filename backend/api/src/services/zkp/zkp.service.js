import { ethers } from 'ethers';
import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import { supabase } from '../../config/db.js';

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
      // Hash document data
      const documentHash = this.hashDocument(driverData);
      
      // Generate proof using snarkjs (call external script)
      const proofData = await this.callSnarkJS(driverData, documentHash);
      
      // Store proof in database
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
    // In production: execute snarkjs via child_process
    // For now, return mock proof
    return {
      proof: {
        a: ['0x123...', '0x456...'],
        b: [['0x789...', '0xabc...'], ['0xdef...', '0xghi...']],
        c: ['0xjkl...', '0xmno...']
      },
      publicSignals: [documentHash, '1']
    };
  }

  async verifyKYCOnChain(userId, proof) {
    try {
      if (!this.contract) throw new Error('ZKPService not configured: missing environment variables');
      // Get user address
      const userData = await this.getUserAddress(userId);
      if (!userData) {
        throw new Error('User not found');
      }

      // Verify on-chain
      const tx = await this.contract.verifyKYC(
        proof.a,
        proof.b,
        proof.c,
        proof.input,
        userData.wallet_address
      );
      
      const receipt = await tx.wait();
      
      // Update database
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
      
      const verified = await this.contract.isVerified(userData.wallet_address);
      return verified;
    } catch (error) {
      logger.error('Verification check failed:', error);
      return false;
    }
  }

  async getDocumentHash(userId) {
    try {
      if (!this.contract) return null;
      const userData = await this.getUserAddress(userId);
      if (!userData) return null;
      
      const hash = await this.contract.getDocumentHash(userData.wallet_address);
      return hash;
    } catch (error) {
      logger.error('Document hash fetch failed:', error);
      return null;
    }
  }

  async verifyDriver(driverData) {
    try {
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