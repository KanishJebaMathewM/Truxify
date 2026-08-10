import axios from 'axios';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';

const DIGILOCKER_TIMEOUT_MS = 10000;

class DigilockerService {
  constructor() {
    this.clientId = process.env.DIGILOCKER_CLIENT_ID;
    this.clientSecret = process.env.DIGILOCKER_CLIENT_SECRET;
    this.redirectUri = process.env.DIGILOCKER_REDIRECT_URI;
    
    // Polygon contract integration
    const rpcUrl = process.env.POLYGON_RPC_URL;
    const privateKey = process.env.RELAYER_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;
    const contractAddress = process.env.DOCUMENT_REGISTRY_CONTRACT || process.env.KYC_VERIFIER_CONTRACT_ADDRESS;

    if (rpcUrl && privateKey && contractAddress) {
      try {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.contractABI = [
          'function registerDocument(address driver, string memory documentType, bytes32 docHash, bool isVerified) external',
          'function getDocument(address driver, string memory documentType) external view returns (bytes32, string memory, uint256, bool)',
          'function hashDocument(bytes32 documentHash, address user) public'
        ];
        this.contract = new ethers.Contract(contractAddress, this.contractABI, this.wallet);
      } catch (err) {
        logger.error({ err }, 'Failed to initialize DocumentRegistry/KYC contract');
      }
    } else {
      logger.warn('DocumentRegistry/KYC contract not configured: missing RPC, key, or contract address');
    }
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
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: DIGILOCKER_TIMEOUT_MS
        });
        return {
          access_token: tokenResponse.data.access_token,
          digilocker_id: tokenResponse.data.digilockerid,
          name: tokenResponse.data.name || 'DigiLocker User'
        };
      } catch (err) {
        logger.error({ err }, '[DigilockerService] OAuth exchange failed');
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

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      throw new Error(`Profile lookup failed: ${profileErr.message}`);
    }

    const walletAddress = profile?.polygon_wallet_address || '0x0000000000000000000000000000000000000000';

    if (this.contract) {
      try {
        logger.info(`[DigilockerService] Submitting document hash on-chain: ${documentHash} for user address: ${walletAddress}`);
        const tx = await this.contract.hashDocument(documentHash, walletAddress);
        await tx.wait();
        logger.info(`[DigilockerService] Smart contract write succeeded. TX hash: ${tx.hash}`);
      } catch (err) {
        logger.warn(`[DigilockerService] Smart contract write failed: ${err.message}. Fallback to DB update.`);
      }
    } else {
      logger.info(`[DigilockerService] Smart contract verification address/private key not set. Mocking on-chain hash submission.`);
    }

    const { error: updateError } = await supabase
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
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: DIGILOCKER_TIMEOUT_MS
        });
        tokenData = tokenResponse.data;
      } catch (err) {
        logger.error({ err }, 'Digilocker token exchange failed');
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
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
          timeout: DIGILOCKER_TIMEOUT_MS
        });
        const files = listResponse.data?.items || [];

        for (const file of files) {
          if (file.doctype === 'ADLNK' || file.doctype === 'DRVLC') {
            const docResponse = await axios.get(`https://api.digitallocker.gov.in/public/oauth2/1/file/${file.uri}`, {
              headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
              timeout: DIGILOCKER_TIMEOUT_MS
            });
            documents.push({
              type: file.doctype === 'DRVLC' ? 'driving_licence' : 'rc_book',
              data: typeof docResponse.data === 'string' ? docResponse.data : JSON.stringify(docResponse.data)
            });
          }
        }
      } catch (err) {
        logger.error({ err }, 'Failed to fetch DigiLocker documents');
        throw new Error('Failed to fetch DigiLocker documents: ' + err.message, { cause: err });
      }
    }

    const syncResults = [];
    for (const doc of documents) {
      const docHash = '0x' + crypto.createHash('sha256').update(doc.data).digest('hex');

      const { data: profile } = await supabase
        .from('profiles')
        .select('polygon_wallet_address')
        .eq('id', driverId)
        .maybeSingle();

      const walletAddress = profile?.polygon_wallet_address;
      let txHash = null;

      if (this.contract && walletAddress) {
        try {
          const tx = await this.contract.registerDocument(walletAddress, doc.type, docHash, true);
          await tx.wait();
          txHash = tx.hash;
        } catch (err) {
          logger.error({ err, docType: doc.type }, 'Blockchain registration failed');
        }
      }

      const { data: docRecord, error: dbErr } = await supabase
        .from('driver_documents')
        .upsert({
          driver_id: driverId,
          document_type: doc.type,
          document_hash: docHash,
          is_verified: true,
          verification_source: isMock ? 'digilocker_mock' : 'digilocker',
          blockchain_tx_hash: txHash,
          updated_at: new Date().toISOString()
        }, { onConflict: 'driver_id,document_type' })
        .select()
        .single();

      if (dbErr) {
        logger.error({ err: dbErr, docType: doc.type }, 'Database record failed');
      } else {
        syncResults.push(docRecord);
      }
    }

    return {
      success: true,
      syncedDocumentsCount: syncResults.length,
      documents: syncResults,
      isMock
    };
  }
}

export default new DigilockerService();
