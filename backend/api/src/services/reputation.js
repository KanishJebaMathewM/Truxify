/**
 * Polygon Blockchain — Driver Reputation Service
 *
 * Wraps the deployed Reputation.sol contract so the ratings route can
 * call increaseReputation() after a successful submit_rating_tx RPC.
 *
 * The contract only exposes two write methods (increase / decrease) and
 * one read method (getReputation). Only increaseReputation is used here:
 * we award 1 on-chain point per submitted star, so a 5-star rating
 * contributes 5 points to the driver's on-chain score.
 *
 * If any of the three required env vars are missing the module exports
 * null so callers can skip the blockchain step gracefully — the same
 * pattern used by Supabase, Redis and Firebase in db.js.
 *
 * Required env vars (see .env.example):
 *   POLYGON_RPC_URL             — JSON-RPC endpoint (Alchemy / Infura / public)
 *   REPUTATION_CONTRACT_ADDRESS — Deployed Reputation.sol address
 *   RELAYER_WALLET_PRIVATE_KEY  — Private key of the authorised relayer wallet
 */

import { ethers } from 'ethers';
import logger from '../middleware/logger.js';

// Minimal ABI — only the subset the backend needs to call.
const REPUTATION_ABI = [
  'function increaseReputation(address driver, uint256 points) external',
  'function getReputation(address driver) external view returns (uint256)',
];

const rpcUrl             = process.env.POLYGON_RPC_URL;
const contractAddress    = process.env.REPUTATION_CONTRACT_ADDRESS;
const relayerPrivateKey  = process.env.RELAYER_WALLET_PRIVATE_KEY;

/** @type {ethers.Contract | null} */
export let reputationContract = null;

if (rpcUrl && contractAddress && relayerPrivateKey) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const relayer  = new ethers.Wallet(relayerPrivateKey, provider);
    reputationContract = new ethers.Contract(contractAddress, REPUTATION_ABI, relayer);
    logger.info('✅ Polygon Reputation contract client initialised.');
  } catch (err) {
    logger.error('❌ Failed to initialise Reputation contract client:', err.message);
  }
} else {
  logger.warn(
    '⚠️  POLYGON_RPC_URL / REPUTATION_CONTRACT_ADDRESS / RELAYER_WALLET_PRIVATE_KEY ' +
    'not set. On-chain reputation updates disabled.'
  );
}

/**
 * Award on-chain reputation points to a driver after a completed rating.
 *
 * Points are calculated as the star value itself (1–5), so a 5-star rating
 * contributes 5 points and a 1-star contributes 1 point.
 *
 * This function is intentionally fire-and-forget — callers should NOT
 * await it on the critical path. A blockchain failure must never block
 * the HTTP response; the Supabase RPC is the source of truth for ratings.
 *
 * @param {string} driverWalletAddress  — 0x-prefixed Polygon address of the driver
 * @param {number} stars                — Rating value (1–5)
 * @returns {Promise<void>}
 */
export async function awardReputationPoints(driverWalletAddress, stars) {
  if (!reputationContract) {
    logger.warn('[reputation] Contract not initialised — skipping on-chain update.');
    return;
  }
  if (!ethers.isAddress(driverWalletAddress)) {
    logger.warn(`[reputation] Invalid driver wallet address "${driverWalletAddress}" — skipping.`);
    return;
  }
  const tx = await reputationContract.increaseReputation(driverWalletAddress, stars);
  logger.info(`[reputation] increaseReputation tx submitted: ${tx.hash}`);
  await tx.wait(1); // wait for 1 confirmation
  logger.info(`[reputation] increaseReputation confirmed for driver ${driverWalletAddress} (+${stars} pts).`);
}

export async function getDriverReputation(walletAddress) {
  if (!reputationContract) {
    return null;
  }

  if (!walletAddress || !ethers.isAddress(walletAddress)) {
    return null;
  }

  try {
    const score = await Promise.race([
      reputationContract.getReputation(walletAddress),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RPC timeout')), 5000)
      ),
    ]);
    
    return score.toString();
  } catch (err) {
    logger.error(
      `[reputation] Failed to fetch on-chain reputation: ${err.message}`
    );
    return null;
  }
}
