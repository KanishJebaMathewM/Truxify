/**
 * Polygon Blockchain — Escrow Payment Service
 *
 * Wraps the deployed Escrow.sol contract so the order routes can
 * call deposit(), releaseFunds(), and refundFunds() during the
 * order lifecycle.
 *
 * The contract uses a relayer-authorization pattern. The backend's
 * relayer wallet (RELAYER_WALLET_PRIVATE_KEY) calls releaseFunds
 * and refundFunds. deposit() is called by the customer wallet or
 * a designated relayer that holds the funds.
 *
 * Required env vars (see .env.example):
 *   POLYGON_RPC_URL              — JSON-RPC endpoint
 *   ESCROW_CONTRACT_ADDRESS      — Deployed Escrow.sol address
 *   RELAYER_WALLET_PRIVATE_KEY   — Private key of the authorised relayer
 */

import { ethers } from 'ethers';
import logger from '../middleware/logger.js';

const ESCROW_ABI = [
  'function deposit(bytes32 bookingId, address payable customer, address payable driver) external payable',
  'function releaseFunds(bytes32 bookingId) external',
  'function refundFunds(bytes32 bookingId) external',
  'function escrows(bytes32 bookingId) external view returns (address customer, address driver, uint256 amount, uint8 status)',
];

const rpcUrl            = process.env.POLYGON_RPC_URL;
const contractAddress   = process.env.ESCROW_CONTRACT_ADDRESS;
const relayerPrivateKey = process.env.RELAYER_WALLET_PRIVATE_KEY;

/** @type {ethers.Contract | null} */
let escrowContract = null;

if (rpcUrl && contractAddress && relayerPrivateKey) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const relayer  = new ethers.Wallet(relayerPrivateKey, provider);
    escrowContract = new ethers.Contract(contractAddress, ESCROW_ABI, relayer);
    logger.info('✅ Polygon Escrow contract client initialised.');
  } catch (err) {
    logger.error('❌ Failed to initialise Escrow contract client:', err.message);
  }
} else {
  logger.warn(
    '⚠️  POLYGON_RPC_URL / ESCROW_CONTRACT_ADDRESS / RELAYER_WALLET_PRIVATE_KEY ' +
    'not set. Escrow payments disabled.'
  );
}

/**
 * Derive a deterministic booking ID from an order's display ID.
 * @param {string} orderDisplayId — e.g. "#FF20260521"
 * @returns {string} bytes32 hex string
 */
export function getEscrowBookingId(orderDisplayId) {
  return ethers.solidityPackedKeccak256(['string'], [`escrow:${orderDisplayId}`]);
}

/**
 * Deposit funds into escrow for a booking.
 * Called when a bid is accepted and the order moves to in_progress.
 *
 * Callers should await the returned promise. If the blockchain transaction
 * fails, the function throws so the caller can avoid updating off-chain state.
 *
 * @param {string} orderDisplayId
 * @param {string} customerWalletAddress — 0x-prefixed Polygon address of the customer
 * @param {string} driverWalletAddress — 0x-prefixed Polygon address of the driver
 * @param {string} amountWei           — amount in wei (string or bigint)
 * @returns {Promise<{txHash: string|null, bookingId: string}>}
 */
export async function escrowDeposit(orderDisplayId, customerWalletAddress, driverWalletAddress, amountWei) {
  const bookingId = getEscrowBookingId(orderDisplayId);

  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — skipping deposit.');
    return { txHash: null, bookingId };
  }
  if (!ethers.isAddress(customerWalletAddress)) {
    logger.warn(`[escrow] Invalid customer wallet address "${customerWalletAddress}" — skipping deposit.`);
    return { txHash: null, bookingId };
  }
  if (!ethers.isAddress(driverWalletAddress)) {
    logger.warn(`[escrow] Invalid driver wallet address "${driverWalletAddress}" — skipping deposit.`);
    return { txHash: null, bookingId };
  }

  const tx = await escrowContract.deposit(bookingId, customerWalletAddress, driverWalletAddress, {
    value: amountWei,
  });
  logger.info(`[escrow] deposit tx submitted: ${tx.hash} for booking ${orderDisplayId}`);
  const receipt = await tx.wait(1);
  logger.info(`[escrow] deposit confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`);
  return { txHash: receipt.hash, bookingId };
}

/**
 * Release escrowed funds to the driver after successful delivery verification.
 * Must be called by an authorised relayer.
 *
 * @param {string} orderDisplayId
 * @returns {Promise<{txHash: string|null, bookingId: string}>}
 */
export async function escrowRelease(orderDisplayId) {
  const bookingId = getEscrowBookingId(orderDisplayId);

  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — skipping releaseFunds.');
    return { txHash: null, bookingId };
  }

  const tx = await escrowContract.releaseFunds(bookingId);
  logger.info(`[escrow] releaseFunds tx submitted: ${tx.hash} for booking ${orderDisplayId}`);
  const receipt = await tx.wait(1);
  logger.info(`[escrow] releaseFunds confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`);
  return { txHash: receipt.hash, bookingId };
}

/**
 * Refund escrowed funds to the customer when an order is cancelled or disputed.
 * Must be called by an authorised relayer.
 *
 * @param {string} orderDisplayId
 * @returns {Promise<{txHash: string|null, bookingId: string}>}
 */
export async function escrowRefund(orderDisplayId) {
  const bookingId = getEscrowBookingId(orderDisplayId);

  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — skipping refundFunds.');
    return { txHash: null, bookingId };
  }

  const tx = await escrowContract.refundFunds(bookingId);
  logger.info(`[escrow] refundFunds tx submitted: ${tx.hash} for booking ${orderDisplayId}`);
  const receipt = await tx.wait(1);
  logger.info(`[escrow] refundFunds confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`);
  return { txHash: receipt.hash, bookingId };
}
