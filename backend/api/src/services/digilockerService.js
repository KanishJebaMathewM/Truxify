import axios from 'axios';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

class DigilockerService {
  constructor() {
    this.clientId = process.env.DIGILOCKER_CLIENT_ID;
    this.clientSecret = process.env.DIGILOCKER_CLIENT_SECRET;
    this.redirectUri = process.env.DIGILOCKER_REDIRECT_URI;
    
    // Polygon contract integration.
    //
    // The two write paths target DIFFERENT contracts:
    //   - DocumentRegistry.sol  → registerDocument() / getDocument()
    //   - KYCVerifier.sol       → hashDocument()
    // A single shared ABI/address silently mixed both, so one contract's
    // address was used for the other's write path. They must be configured
    // separately (DOCUMENT_REGISTRY_CONTRACT and KYC_VERIFIER_CONTRACT_ADDRESS).
    const rpcUrl = process.env.POLYGON_RPC_URL;
    const privateKey = process.env.RELAYER_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;

    const documentRegistryAddress = process.env.DOCUMENT_REGISTRY_CONTRACT;
    const kycVerifierAddress = process.env.KYC_VERIFIER_CONTRACT_ADDRESS;

    if (rpcUrl && privateKey && documentRegistryAddress && kycVerifierAddress) {
      try {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);

        // ABI for DocumentRegistry.sol only.
        this.documentRegistryABI = [
          'function registerDocument(address driver, string memory documentType, bytes32 docHash, bool isVerified) external',
          'function getDocument(address driver, string memory documentType) external view returns (bytes32, string memory, uint256, bool)'
        ];
        this.documentRegistry = new ethers.Contract(documentRegistryAddress, this.documentRegistryABI, this.wallet);

        // ABI for KYCVerifier.sol only.
        this.kycVerifierABI = [
          'function hashDocument(bytes32 documentHash, address user) public',
          'function isVerified(address user) public view returns (bool)'
        ];
        this.kycVerifier = new ethers.Contract(kycVerifierAddress, this.kycVerifierABI, this.wallet);
      } catch (err) {
        logger.error('Failed to initialize DocumentRegistry/KYC contracts:', err.message);
      }
    } else {
      logger.warn('DocumentRegistry/KYC contracts not configured: missing RPC, key, DOCUMENT_REGISTRY_CONTRACT, or KYC_VERIFIER_CONTRACT_ADDRESS');
    }
  }

  /**
   * Probe both contracts at startup so a mismatched address/ABI fails loudly
   * instead of silently skipping the on-chain write path (mirrors
   * validateEscrowSetup in escrow.js).
   *
   * @returns {Promise<boolean>} — true only if both contracts respond.
   */
  async validateSetup() {
    if (!this.documentRegistry || !this.kycVerifier) {
      logger.warn('[DigilockerService] Setup validation skipped — contracts not initialised (env vars missing).');
      return false;
    }

    const provider = this.documentRegistry.runner.provider;
    const checks = [
      {
        name: 'DocumentRegistry',
        contract: this.documentRegistry,
        probe: () => this.documentRegistry.getDocument('0x0000000000000000000000000000000000000000', '')
      },
      {
        name: 'KYCVerifier',
        contract: this.kycVerifier,
        probe: () => this.kycVerifier.isVerified('0x0000000000000000000000000000000000000000')
      }
    ];

    let valid = true;
    for (const { name, contract, probe } of checks) {
      const address = contract.target;
      try {
        const code = await provider.getCode(address);
        if (code === '0x') {
          logger.error(`[DigilockerService] ❌ No contract deployed at ${address}. Check the ${name} env var in your .env.`);
          valid = false;
          continue;
        }
      } catch (err) {
        logger.error(`[DigilockerService] ❌ Failed to query bytecode at ${address}: ${err.message}`);
        valid = false;
        continue;
      }
      try {
        await probe();
        logger.info(`[DigilockerService] ✅ ${name} ABI verified at ${address} — read-only eth_call succeeded.`);
      } catch (err) {
        logger.error(
          `[DigilockerService] ❌ Contract at ${address} does not respond to the expected ${name} ABI. ` +
          `This likely means ${name} is pointed at the wrong contract (swap DOCUMENT_REGISTRY_CONTRACT / KYC_VERIFIER_CONTRACT_ADDRESS).`
        );
        valid = false;
      }
    }

    return valid;
  }

  get isMock() {
    // Fail-closed in production unless explicitly allowed / mocked locally
    if (process.env.NODE_ENV === 'production' && process.env.DIGILOCKER_MOCK === 'true') {
      logger.error('[DigilockerService] DIGILOCKER_MOCK=true is prohibited in production NODE_ENV');
      return false;
    }
    return process.env.DIGILOCKER_MOCK === 'true';
  }

  async exchangeCode(code) {
    if (!this.isMock) {
      if (!this.clientId || !this.clientSecret || !code) {
        logger.warn('[DigilockerService] DigiLocker integration missing credentials or code; refusing mock fallback');
        return { success: false, error: 'DigiLocker verification is not configured' };
      }
      try {
        const tokenResponse = await axios.post('https://api.digitallocker.gov.in/public/oauth2/1/token', {
          code,
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri
        }, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return {
          access_token: tokenResponse.data.access_token,
          digilocker_id: tokenResponse.data.digilockerid,
          name: tokenResponse.data.name || 'DigiLocker User'
        };
      } catch (err) {
        logger.error('[DigilockerService] OAuth exchange failed:', err.message);
        return { success: false, error: err.message };
      }
    }

    logger.info(`[DigilockerService] Exchanging OAuth code in mock mode: ${code}`);
    return {
      access_token: `mock_digilocker_token_${crypto.randomBytes(8).toString('hex')}`,
      digilocker_id: `DLID_${crypto.randomBytes(4).toString('hex')}`,
      name: 'Suresh Kumar',
    };
  }

  async verifyDocuments(userId, accessToken) {
    if (!this.isMock) {
      logger.warn('[DigilockerService] DigiLocker integration not configured; refusing auto-approval');
      return { success: false, error: 'DigiLocker verification is not configured', is_digilocker_verified: false };
    }
    logger.info(`[DigilockerService] Verifying documents for user ${userId} with token ${accessToken}`);

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

    const serialized = JSON.stringify({ dlData, rcData, insuranceData });
    const documentHash = '0x' + crypto.createHash('sha256').update(serialized).digest('hex');

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      throw new Error(`Profile lookup failed: ${profileErr.message}`);
    }

    const walletAddress = profile?.polygon_wallet_address || '0x0000000000000000000000000000000000000000';

    if (this.kycVerifier) {
      try {
        logger.info(`[DigilockerService] Submitting document hash on-chain: ${documentHash} for user address: ${walletAddress}`);
        const tx = await this.kycVerifier.hashDocument(documentHash, walletAddress);
        await tx.wait();
        logger.info(`[DigilockerService] Smart contract write succeeded. TX hash: ${tx.hash}`);
      } catch (err) {
        logger.warn(`[DigilockerService] Smart contract write failed: ${err.message}. Fallback to DB update.`);
      }
    } else {
      logger.info(`[DigilockerService] KYCVerifier address/private key not set. Mocking on-chain hash submission.`);
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ is_digilocker_verified: true })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Failed to update profile verification status: ${updateError.message}`);
    }

    return {
      success: true,
      is_digilocker_verified: true,
      document_hash: documentHash,
      verified_documents: ['driving_licence', 'rc_book', 'insurance']
    };
  }

  async verifyAndSyncDocuments(driverId, code) {
    let tokenData;
    let isMock = this.isMock;

    if (!this.clientId || !this.clientSecret || !code) {
      if (!isMock) {
        throw new Error('DigiLocker credentials or OAuth code are missing. Set DIGILOCKER_MOCK=true only for local testing.');
      }
      logger.warn('Digilocker credentials or code missing. Running in mock mode.');
      tokenData = {
        access_token: 'mock_digilocker_access_token_12345',
        digilockerid: 'mock_digi_id_abcde'
      };
    } else {
      try {
        const tokenResponse = await axios.post('https://api.digitallocker.gov.in/public/oauth2/1/token', {
          code,
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri
        }, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        tokenData = tokenResponse.data;
      } catch (err) {
        logger.error('Digilocker token exchange failed:', err.message);
        throw new Error('Digilocker token exchange failed: ' + err.message, { cause: err });
      }
    }

    const documents = [];
    if (isMock) {
      documents.push({
        type: 'rc_book',
        data: JSON.stringify({
          registrationNumber: 'MH-12-PQ-9999',
          ownerName: 'Rahul Sharma',
          chassisNumber: 'MBLHA33A7H902831',
          engineNumber: 'E3B940231',
          vehicleClass: 'LPT 1613'
        })
      });
      documents.push({
        type: 'driving_licence',
        data: JSON.stringify({
          licenseNumber: 'DL-1420190012345',
          holderName: 'Rahul Sharma',
          validity: '2039-12-31',
          classOfVehicle: 'MCWG, LMV, TRANS'
        })
      });
    } else {
      try {
        const listResponse = await axios.get('https://api.digitallocker.gov.in/public/oauth2/1/files/issued', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
        });
        const files = listResponse.data?.items || [];

        for (const file of files) {
          if (file.doctype === 'ADLNK' || file.doctype === 'DRVLC') {
            const docResponse = await axios.get(`https://api.digitallocker.gov.in/public/oauth2/1/file/${file.uri}`, {
              headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            documents.push({
              type: file.doctype === 'DRVLC' ? 'driving_licence' : 'rc_book',
              data: typeof docResponse.data === 'string' ? docResponse.data : JSON.stringify(docResponse.data)
            });
          }
        }
      } catch (err) {
        logger.error('Failed to fetch DigiLocker documents:', err.message);
        throw new Error('Failed to fetch DigiLocker documents: ' + err.message, { cause: err });
      }
    }

    const syncResults = [];
    const syncErrors = [];
    for (const doc of documents) {
      const docHash = '0x' + crypto.createHash('sha256').update(doc.data).digest('hex');

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('polygon_wallet_address')
        .eq('id', driverId)
        .maybeSingle();

      const walletAddress = profile?.polygon_wallet_address;
      let txHash = null;

      if (this.documentRegistry && walletAddress) {
        try {
          const tx = await this.documentRegistry.registerDocument(walletAddress, doc.type, docHash, true);
          await tx.wait();
          txHash = tx.hash;
        } catch (err) {
          logger.error(`Blockchain registration failed for ${doc.type}:`, err.message);
        }
      }

      const { data: docRecord, error: dbErr } = await supabaseAdmin
        .from('driver_documents')
        .select('id')
        .eq('driver_id', driverId)
        .eq('document_type', doc.type)
        .maybeSingle();

      if (findError) {
        logger.error(`Find driver_documents failed for ${doc.type}:`, findError.message);
        syncErrors.push(`find:${findError.message}`);
        continue;
      }

      const { data: docRecord, error: dbErr } = existing
        ? await supabase
            .from('driver_documents')
            .update(docPayload)
            .eq('id', existing.id)
            .select()
            .single()
        : await supabase
            .from('driver_documents')
            .insert(docPayload)
            .select()
            .single();

      if (dbErr) {
        logger.error({ 
          err: dbErr, 
          driverId, 
          docType: doc.type, 
          docHash, 
          message: dbErr.message,
          hint: dbErr.hint
        }, '[DigilockerService] Database upsert failed during sync');
        syncErrors.push({ docType: doc.type, error: dbErr.message });
      } else {
        syncResults.push(docRecord);
      }
    }

    if (syncErrors.length > 0) {
      return {
        success: false,
        error: syncErrors.join('; '),
        syncedDocumentsCount: syncResults.length,
        documents: syncResults,
        isMock
      };
    }

    return {
      success: syncErrors.length === 0,
      syncedDocumentsCount: syncResults.length,
      documents: syncResults,
      errors: syncErrors,
      isMock
    };
  }
}

export default new DigilockerService();
