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
import { measureExecution } from '../core/performanceMetrics.js';

// Safe math utilities for reputation calculations.
// Boundary clamping (0–MAX_REPUTATION) is handled by clampReputation.
function safeAdd(a, b) {
  const result = Number(a) + Number(b);
  return Number.isFinite(result) ? result : 0;
}

function safeSubtract(a, b) {
  const result = Number(a) - Number(b);
  return Number.isFinite(result) ? result : 0;
}

/** @type {number} Must match Reputation.sol MAX_REPUTATION constant */
const MAX_REPUTATION = 10000;

function clampReputation(value) {
  return Math.max(0, Math.min(MAX_REPUTATION, Number(value) || 0));
}

// Minimal ABI — only the subset the backend needs to call.
const REPUTATION_ABI = [
  'function increaseReputation(address driver, uint256 points) external',
  'function decreaseReputation(address driver, uint256 points) external',
  'function getReputation(address driver) external view returns (uint256)',
];
/** @type {ethers.Contract | null} */
export let reputationContract = null;

/**
 * Initialises or resets the Reputation contract client.
 * Exposed for testing and runtime reconfiguration.
 */
export function initReputationContract() {
  const rpcUrl             = process.env.POLYGON_RPC_URL;
  const contractAddress    = process.env.REPUTATION_CONTRACT_ADDRESS;
  const relayerPrivateKey  = process.env.RELAYER_WALLET_PRIVATE_KEY;

  if (rpcUrl && contractAddress && relayerPrivateKey) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const relayer  = new ethers.Wallet(relayerPrivateKey, provider);
      reputationContract = new ethers.Contract(contractAddress, REPUTATION_ABI, relayer);
      logger.info('✅ Polygon Reputation contract client initialised.');
    } catch (err) {
      reputationContract = null;
      logger.error('❌ Failed to initialise Reputation contract client:', err.message);
    }
  } else {
    reputationContract = null;
    logger.warn(
      '⚠️  POLYGON_RPC_URL / REPUTATION_CONTRACT_ADDRESS / RELAYER_WALLET_PRIVATE_KEY ' +
      'not set. On-chain reputation updates disabled.'
    );
  }
}

// Initialise on load
initReputationContract();

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
const REPUTATION_RETRY_MAX = 3;
const REPUTATION_RETRY_DELAY_MS = 2000;

async function retryWithBackoff(fn, maxRetries, baseDelayMs) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      logger.warn(`[reputation] Retry ${attempt}/${maxRetries} after ${baseDelayMs * attempt}ms: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}

export async function awardReputationPoints(driverWalletAddress, stars) {
  return measureExecution('ReputationService.awardReputationPoints', async () => {
  if (!reputationContract) {
    logger.warn('[reputation] Contract not initialised — skipping on-chain update.');
    return;
  }
  if (!ethers.isAddress(driverWalletAddress)) {
    logger.warn(`[reputation] Invalid driver wallet address "${driverWalletAddress}" — skipping.`);
    return;
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    logger.warn(`[reputation] Invalid stars value ${stars} — must be 1-5. Skipping on-chain update.`);
    return;
  }
  try {
    await retryWithBackoff(async () => {
      const tx = await reputationContract.increaseReputation(driverWalletAddress, stars);
      logger.info(`[reputation] increaseReputation tx submitted: ${tx.hash}`);
      await tx.wait(1);
      logger.info(`[reputation] increaseReputation confirmed for driver ${driverWalletAddress} (+${stars} pts).`);
    }, REPUTATION_RETRY_MAX, REPUTATION_RETRY_DELAY_MS);
  } catch (err) {
    logger.error(`[reputation] increaseReputation failed for driver ${driverWalletAddress} after ${REPUTATION_RETRY_MAX} retries: ${err.message}`);
    throw err;
  }
  });
}

/**
 * Fetch the on-chain reputation score for a driver.
 *
 * @param {string} walletAddress — 0x-prefixed Polygon address of the driver
 * @returns {Promise<number|null>}
 */
export async function getDriverReputation(walletAddress) {
  return measureExecution('ReputationService.getDriverReputation', async () => {
  if (!reputationContract) {
    logger.warn('[reputation] Contract not initialised — skipping on-chain retrieval.');
    return null;
  }
  if (!ethers.isAddress(walletAddress)) {
    logger.warn(`[reputation] Invalid wallet address "${walletAddress}" — skipping.`);
    return null;
  }
  let timeoutId;
  try {
    const score = await Promise.race([
      reputationContract.getReputation(walletAddress),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('RPC timeout')), 5000);
      }),
    ]);
    clearTimeout(timeoutId);
    return Number(score);
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error(`[reputation] Failed to fetch on-chain reputation for ${walletAddress}: ${err.message}`);
    return null;
  }
  });
}
