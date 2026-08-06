import crypto from 'crypto';
import { ethers } from 'ethers';
import { supabase } from '../../config/db.js';
import logger from '../../middleware/logger.js';

class DigilockerService {
  constructor() {
    this.isMock = process.env.DIGILOCKER_MOCK === 'true';
    this.providerUrl = process.env.POLYGON_RPC_URL || 'http://localhost:8545';
    this.privateKey = process.env.RELAYER_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;
    this.verifierAddress = process.env.KYC_VERIFIER_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000';
    this.verifierABI = [
      'function hashDocument(bytes32 documentHash, address user) public'
    ];
  }

  async exchangeCode(code) {
    if (!this.isMock) {
      logger.warn('[DigilockerService] DigiLocker integration not configured; refusing to fabricate an identity');
      return { success: false, error: 'DigiLocker verification is not configured' };
    }
    logger.info(`[DigilockerService] Exchanging OAuth code: ${code}`);
    // Mock the OAuth flow exchange response
    return {
      access_token: `mock_digilocker_token_${crypto.randomBytes(8).toString('hex')}`,
      digilocker_id: `DLID_${crypto.randomBytes(4).toString('hex')}`,
      name: 'Suresh Kumar',
    };
  }

  async verifyDocuments(userId, accessToken) {
    if (!this.isMock) {
      logger.warn('[DigilockerService] DigiLocker integration not configured; refusing to auto-approve KYC with fabricated documents');
      return { success: false, error: 'DigiLocker verification is not configured', is_digilocker_verified: false };
    }
    logger.info(`[DigilockerService] Verifying documents for user ${userId} with token ${accessToken}`);

    // Mock Digilocker API retrieval of Driving Licence, RC Book, and Insurance Certificate
    const dlData = {
      doc_type: 'driving_licence',
      licence_no: 'DL-12345678901',
      holder: 'Suresh Kumar',
      expiry: '2035-12-31',
    };

    const rcData = {
      doc_type: 'rc_book',
      registration_no: 'GJ-05-XX-1234',
      owner: 'Suresh Kumar',
      expiry: '2030-05-15',
    };

    const insuranceData = {
      doc_type: 'insurance',
      policy_no: 'POL-987654',
      holder: 'Suresh Kumar',
      expiry: '2027-12-31',
    };

    // Packages and hashes document data
    const serialized = JSON.stringify({ dlData, rcData, insuranceData });
    const documentHash = '0x' + crypto.createHash('sha256').update(serialized).digest('hex');

    // Fetch user profile and wallet address
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      throw new Error(`Profile lookup failed: ${profileErr.message}`);
    }

    const walletAddress = profile?.polygon_wallet_address || '0x0000000000000000000000000000000000000000';

    // Submit document hash to Polygon KYCVerifier contract on-chain
    if (this.privateKey && this.verifierAddress !== '0x0000000000000000000000000000000000000000') {
      try {
        const provider = new ethers.JsonRpcProvider(this.providerUrl);
        const wallet = new ethers.Wallet(this.privateKey, provider);
        const contract = new ethers.Contract(this.verifierAddress, this.verifierABI, wallet);
        logger.info(`[DigilockerService] Submitting document hash on-chain: ${documentHash} for user address: ${walletAddress}`);
        const tx = await contract.hashDocument(documentHash, walletAddress);
        await tx.wait();
        logger.info(`[DigilockerService] Smart contract write succeeded. TX hash: ${tx.hash}`);
      } catch (err) {
        logger.warn(`[DigilockerService] Smart contract write failed: ${err.message}. Fallback to DB update.`);
      }
    } else {
      logger.info(`[DigilockerService] Smart contract verification address/private key not set. Mocking on-chain hash submission.`);
    }

    // Update profiles database table to set is_digilocker_verified = true
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ is_digilocker_verified: true })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Failed to update profile verification status: ${updateError.message}`);
    }

    // Insert document records in driver_documents table
    const docsToUpsert = [
      {
        driver_id: userId,
        document_type: 'driving_licence',
        storage_path: `digilocker/${userId}/driving_licence.json`,
        mime_type: 'application/json',
        status: 'approved',
      },
      {
        driver_id: userId,
        document_type: 'rc_book',
        storage_path: `digilocker/${userId}/rc_book.json`,
        mime_type: 'application/json',
        status: 'approved',
      },
      {
        driver_id: userId,
        document_type: 'insurance',
        storage_path: `digilocker/${userId}/insurance.json`,
        mime_type: 'application/json',
        status: 'approved',
      }
    ];

    for (const doc of docsToUpsert) {
      // Clear any prior uploads of this type to prevent duplicate keys
      await supabase
        .from('driver_documents')
        .delete()
        .eq('driver_id', userId)
        .eq('document_type', doc.document_type);

      const { error: insertErr } = await supabase
        .from('driver_documents')
        .insert(doc);

      if (insertErr) {
        logger.error(`[DigilockerService] Failed to insert driver document ${doc.document_type}: ${insertErr.message}`);
      }
    }

    return {
      success: true,
      documentHash,
      is_digilocker_verified: true,
    };
  }
}

export default new DigilockerService();
