/**
 * Polygon Blockchain — Escrow Payment Service
 *
 * Wraps the deployed Escrow.sol contract so the order routes can
 * call deposit(), releaseFunds(), and refundFunds() during the
 * order lifecycle.
 *
 * The contract uses a relayer-authorization pattern. The backend's
 * relayer wallet (RELAYER_WALLET_PRIVATE_KEY) calls releaseFunds
 * and refundFunds. deposit() is sent by the **customer's wallet**
 * directly — the contract requires msg.sender == customer to
 * prevent the relayer from bearing the escrow cost.
 *
 * The escrowDeposit() function below builds the deposit transaction
 * and returns it as an unsigned popultated transaction so the
 * customer's wallet can sign and submit it. After the customer
 * confirms the on-chain deposit, the backend records the txHash.
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
 * Build an unsigned deposit transaction for the customer's wallet to sign.
 * Called when a bid is accepted and the order moves to in_progress.
 *
 * The customer wallet must have MATIC on Polygon to cover the deposit amount
 * plus gas. After the customer signs and submits the transaction, the
 * caller should pass the returned txHash to recordDepositTx() so the
 * backend can confirm the on-chain deposit.
 *
 * @param {string} orderDisplayId
 * @param {string} customerWalletAddress — 0x-prefixed Polygon address of the customer
 * @param {string} driverWalletAddress   — 0x-prefixed Polygon address of the driver
 * @param {string} amountWei             — amount in wei (string or bigint)
 * @returns {Promise<{txData: object|null, bookingId: string}>}
 */
export async function buildDepositTx(orderDisplayId, customerWalletAddress, driverWalletAddress, amountWei) {
  const bookingId = getEscrowBookingId(orderDisplayId);

  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — cannot build deposit tx.');
    return { txData: null, bookingId };
  }
  if (!ethers.isAddress(customerWalletAddress)) {
    logger.warn(`[escrow] Invalid customer wallet address "${customerWalletAddress}" — skipping deposit.`);
    return { txData: null, bookingId };
  }
  if (!ethers.isAddress(driverWalletAddress)) {
    logger.warn(`[escrow] Invalid driver wallet address "${driverWalletAddress}" — skipping deposit.`);
    return { txData: null, bookingId };
  }

  const contractInterface = escrowContract.interface;
  const data = contractInterface.encodeFunctionData('deposit', [
    bookingId,
    customerWalletAddress,
    driverWalletAddress,
  ]);

  const feeData = await escrowContract.runner.provider.getFeeData();
  const block = await escrowContract.runner.provider.getBlock('latest');

  const txData = {
    to: contractAddress,
    data,
    value: amountWei,
    gasLimit: 300000n,
    maxFeePerGas: feeData.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
    nonce: undefined,
    chainId: block.chainId ?? undefined,
    type: 2,
  };

  logger.info(`[escrow] Deposit tx built for booking ${orderDisplayId}`);
  return { txData, bookingId };
}

export async function recordDepositTx(bookingId, txHash) {
  if (!escrowContract) {
    return { error: 'Contract not initialised' };
  }
  if (!ethers.isHexString(txHash, 32)) {
    return { error: 'Invalid transaction hash' };
  }

  const provider = escrowContract.runner.provider;
  const receipt = await provider.waitForTransaction(txHash, 1);
  if (!receipt || receipt.status === 0) {
    return { error: 'Transaction reverted or not found on chain' };
  }

  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    return { error: 'Transaction details not found' };
  }

  if (!tx.to || tx.to.toLowerCase() !== contractAddress.toLowerCase()) {
    return { error: 'Transaction destination is not the Escrow contract' };
  }

  let decoded;
  try {
    decoded = escrowContract.interface.parseTransaction({ data: tx.data, value: tx.value });
  } catch (err) {
    return { error: 'Failed to parse transaction data' };
  }

  if (!decoded || decoded.name !== 'deposit') {
    return { error: 'Transaction is not a deposit call' };
  }

  const [txBookingId] = decoded.args;
  if (txBookingId !== bookingId) {
    return { error: 'Transaction booking ID does not match' };
  }

  logger.info(`[escrow] deposit confirmed for booking ${bookingId} in block ${receipt.blockNumber}`);
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
