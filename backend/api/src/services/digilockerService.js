import axios from 'axios';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

const DIGILOCKER_CLIENT_ID = process.env.DIGILOCKER_CLIENT_ID;
const DIGILOCKER_CLIENT_SECRET = process.env.DIGILOCKER_CLIENT_SECRET;
const DIGILOCKER_REDIRECT_URI = process.env.DIGILOCKER_REDIRECT_URI;
const DIGILOCKER_TOKEN_URL = process.env.DIGILOCKER_TOKEN_URL || 'https://digilocker.meripehchan.gov.in/public/oauth2/1/token';
const DIGILOCKER_DOC_URL = process.env.DIGILOCKER_DOC_URL || 'https://digilocker.meripehchan.gov.in/public/oauth2/1/xml';

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL;
const CONTRACT_ADDRESS = process.env.DOCUMENT_REGISTRY_CONTRACT_ADDRESS;
const CONTRACT_ABI = [
  'function registerDocumentHash(bytes32 docHash, string docType, address driverAddress) public returns (bool)'
];

export async function exchangeDigilockerCode(code) {
  try {
    const params = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: DIGILOCKER_CLIENT_ID,
      client_secret: DIGILOCKER_CLIENT_SECRET,
      redirect_uri: DIGILOCKER_REDIRECT_URI,
    });

    const response = await axios.post(DIGILOCKER_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    return response.data;
  } catch (err) {
    logger.error({ err }, '[DigiLocker] Token exchange failed');
    throw new Error('Failed to exchange DigiLocker authorization code', { cause: err });
  }
}

export function computeDocumentHash(documentBytes) {
  const buffer = Buffer.isBuffer(documentBytes) ? documentBytes : Buffer.from(documentBytes);
  return ethers.keccak256(buffer);
}

export async function recordOnChainHash(docHash, docType, driverWalletAddress) {
  if (!POLYGON_RPC_URL || !process.env.BLOCKCHAIN_PRIVATE_KEY || !CONTRACT_ADDRESS) {
    logger.warn('[DigiLocker] Blockchain environment variables missing; recording hash in fallback storage mode.');
    return { txHash: null, verifiedOnChain: false };
  }

  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
    const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    const tx = await contract.registerDocumentHash(docHash, docType, driverWalletAddress);
    const receipt = await tx.wait();

    return { txHash: receipt.hash, verifiedOnChain: true };
  } catch (err) {
    logger.error({ err, docHash, docType }, '[DigiLocker] On-chain hash registration failed');
    throw new Error('Failed to register document hash on Polygon', { cause: err });
  }
}

export async function verifyAndStoreDocument({ driverId, code, docType, driverWalletAddress }) {
  const tokenData = await exchangeDigilockerCode(code);
  const accessToken = tokenData.access_token;

  let docResponse;
  try {
    docResponse = await axios.get(DIGILOCKER_DOC_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
      timeout: 15000,
    });
  } catch (err) {
    logger.error({ err, driverId, docType }, '[DigiLocker] Fetching document XML/data failed');
    throw new Error('Failed to fetch verified document from DigiLocker', { cause: err });
  }

  const documentBytes = Buffer.from(docResponse.data);
  const docHash = computeDocumentHash(documentBytes);
  const { txHash, verifiedOnChain } = await recordOnChainHash(docHash, docType, driverWalletAddress);

  if (supabaseAdmin) {
    const { error: dbError } = await supabaseAdmin
      .from('driver_documents')
      .upsert({
        driver_id: driverId,
        document_type: docType,
        verification_status: 'verified',
        is_govt_verified: true,
        doc_hash: docHash,
        on_chain_tx_hash: txHash,
        verified_at: new Date().toISOString(),
      }, { onConflict: 'driver_id, document_type' });

    if (dbError) {
      logger.error({ err: dbError, driverId, docType }, '[DigiLocker] Failed to update driver_documents database');
      throw new Error(dbError.message, { cause: dbError });
    }
  }

  return {
    success: true,
    verificationStatus: 'verified',
    isGovtVerified: true,
    docHash,
    txHash,
    verifiedOnChain,
  };
}
