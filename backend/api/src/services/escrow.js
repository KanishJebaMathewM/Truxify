/**
 * Polygon Blockchain — Escrow Payment Service
 *
 * Wraps the deployed TruxifyEscrow.sol contract so the order routes can
 * call createBooking(), releasePayment(), and cancelBooking() during the
 * order lifecycle.
 *
 * The contract uses OpenZeppelin's Ownable pattern. The backend's
 * relayer wallet (RELAYER_WALLET_PRIVATE_KEY) calls releasePayment
 * and cancelBooking. createBooking() is sent by the **customer's wallet**
 * directly — the contract requires msg.sender == customer to
 * prevent the relayer from bearing the escrow cost.
 *
 * The buildDepositTx() function below builds the deposit transaction
 * and returns it as an unsigned populated transaction so the
 * customer's wallet can sign and submit it. After the customer
 * confirms the on-chain deposit, the backend records the txHash.
 *
 * Startup validation:
 *   When all env vars are set, the module performs two checks:
 *   1. provider.getCode(contractAddress) — verifies bytecode exists at the address
 *   2. bookings(0) eth_call — verifies the contract responds with the expected ABI
 *
 * Required env vars (see .env.example):
 *   POLYGON_RPC_URL              — JSON-RPC endpoint
 *   ESCROW_CONTRACT_ADDRESS      — Deployed TruxifyEscrow.sol address
 *   RELAYER_WALLET_PRIVATE_KEY   — Private key of the authorised relayer
 */

import { ethers } from 'ethers'
import * as Sentry from '@sentry/node'
import logger from '../middleware/logger.js'
import { measureExecution } from '../core/performanceMetrics.js'

const ESCROW_ABI = [
  'function createBooking(uint256 bookingId, address payable driver) external payable',
  'function releasePayment(uint256 bookingId) external',
  'function cancelBooking(uint256 bookingId) external',
  'function bookings(uint256 bookingId) external view returns (address customer, address driver, uint256 amount, uint8 status, bool paid, uint256 createdAt)'
]

const rpcUrl            = process.env.POLYGON_RPC_URL;
const contractAddress   = process.env.ESCROW_CONTRACT_ADDRESS;
const relayerPrivateKey = process.env.RELAYER_WALLET_PRIVATE_KEY;
function parseEnvFloat(raw, defaultVal, name) {
  const val = parseFloat(raw || defaultVal);
  if (isNaN(val) || val <= 0) {
    throw new Error(`Invalid ${name}: "${raw}" — must be a positive number`);
  }
  return val;
}

export const ESCROW_MATIC_PER_PAISA = parseEnvFloat(process.env.ESCROW_MATIC_PER_PAISA, '0.01', 'ESCROW_MATIC_PER_PAISA');
const MAX_ESCROW_MATIC = parseEnvFloat(process.env.MAX_ESCROW_MATIC, '5', 'MAX_ESCROW_MATIC');

/** @type {ethers.Contract | null} */
let escrowContract = null

if (rpcUrl && contractAddress && relayerPrivateKey) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const relayer  = new ethers.Wallet(relayerPrivateKey, provider);
    escrowContract = new ethers.Contract(contractAddress, ESCROW_ABI, relayer);
    logger.info('✅ Polygon Escrow contract client initialised.');
    logger.info(`📊 Escrow rate: ${ESCROW_MATIC_PER_PAISA} MATIC/paisa → max deposit: ${MAX_ESCROW_MATIC} MATIC`);
  } catch (err) {
    logger.error('❌ Failed to initialise Escrow contract client:', err.message)
    Sentry.captureException(err)
  }
} else {
  logger.warn(
    '⚠️  POLYGON_RPC_URL / ESCROW_CONTRACT_ADDRESS / RELAYER_WALLET_PRIVATE_KEY ' +
    'not set. Escrow payments disabled.'
  )
}

/**
 * Validate the deployment setup for the escrow contract.
 *
 * Called once at server startup (from index.js) to verify that:
 *   a) Bytecode exists at ESCROW_CONTRACT_ADDRESS (not an empty address)
 *   b) The contract at that address responds to the expected ABI
 *
 * If either check fails, this function returns false and logs details.
 * The escrow service will continue in degraded mode (all operations
 * return { txData: null }) — the server does NOT crash so that
 * non-escrow functionality stays available.
 *
 * @returns {Promise<boolean>} — true if validation passed
 */
export async function validateEscrowSetup () {
  return measureExecution('EscrowService.validateEscrowSetup', async () => {
  if (!escrowContract) {
    logger.warn('[escrow] Setup validation skipped — contract not initialised (env vars missing).')
    return false
  }

  const provider = escrowContract.runner.provider
  const address = escrowContract.target

  // Validation 1: Verify bytecode exists
  try {
    const code = await provider.getCode(address)
    if (code === '0x') {
      logger.error(
        `[escrow] ❌ No contract deployed at ${address}. ` +
        'Check ESCROW_CONTRACT_ADDRESS in your .env.'
      )
      return false
    }
    logger.info(`[escrow] ✅ Bytecode confirmed at ${address} (${(code.length - 2) / 2} bytes).`)
  } catch (err) {
    logger.error(`[escrow] ❌ Failed to query bytecode at ${address}: ${err.message}`)
    return false
  }

  // Validation 2: Verify the contract responds with the expected ABI
  // We call bookings(0) as a read-only probe — this function exists ONLY
  // in TruxifyEscrow.sol (not in the deprecated Escrow.sol).
  try {
    const probeContract = new ethers.Contract(address, ESCROW_ABI, provider)
    await probeContract.bookings(0)
    logger.info('[escrow] ✅ Contract ABI verified — read-only eth_call succeeded.')
  } catch (err) {
    logger.error(
      `[escrow] ❌ Contract at ${address} does not respond to 'bookings(uint256)'. ` +
      'This likely means it is NOT TruxifyEscrow.sol. ' +
      'Check that ESCROW_CONTRACT_ADDRESS points to the active TruxifyEscrow contract, ' +
      'not the deprecated Escrow.sol.'
    )
    return false
  }

  return true
  });
}

/**
 * Convert an amount in paisa to its equivalent MATIC wei value
 * using the configured ESCROW_MATIC_PER_PAISA rate.
 *
 * @param {number|string} paisa - Amount in paisa (e.g. 5000 = ₹50)
 * @returns {bigint} Amount in wei
 * @throws {RangeError} If paisa is negative, NaN, or exceeds safety cap
 */
export function paisaToMaticWei(paisa) {
  const amount = Number(paisa);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`Invalid paisa amount: ${paisa}`);
  }
  const matic = amount * ESCROW_MATIC_PER_PAISA;
  if (matic > MAX_ESCROW_MATIC) {
    throw new RangeError(`Deposit ${matic} MATIC exceeds safety cap of ${MAX_ESCROW_MATIC} MATIC (${paisa} paisa @ ${ESCROW_MATIC_PER_PAISA} MATIC/paisa)`);
  }
  return ethers.parseEther(matic.toFixed(18));
}

/**
 * Check whether the escrow contract client has been successfully initialised.
 * @returns {boolean}
 */
export function isEscrowEnabled() {
  return escrowContract !== null;
}

/**
 * Health check for the escrow system.
 * Returns the status of the escrow contract client and optionally makes a
 * lightweight eth_call to verify the contract is reachable on-chain.
 *
 * @returns {Promise<{status: string, chainId?: number, error?: string}>}
 */
export async function checkEscrowHealth() {
  return measureExecution('EscrowService.checkEscrowHealth', async () => {
  if (!escrowContract) {
    return { status: 'not_configured' };
  }

  try {
    const provider = escrowContract.runner.provider;
    const network = await provider.getNetwork();
    return {
      status: 'connected',
      chainId: Number(network.chainId),
    };
  } catch (err) {
    logger.error('[escrow] Health check failed:', err.message);
    return { status: 'failed', error: err.message };
  }
  });
}

/**
 * Derive a deterministic booking ID from an order's display ID.
 * @param {string} orderDisplayId — e.g. "#FF20260521"
 * @returns {string} bytes32 hex string
 */
export function getEscrowBookingId (orderDisplayId) {
  return ethers.solidityPackedKeccak256(['string'], [`escrow:${orderDisplayId}`])
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
 * @param {string} driverWalletAddress   — 0x-prefixed Polygon address of the driver
 * @param {string} amountWei             — amount in wei (string or bigint)
 * @returns {Promise<{txData: object|null, bookingId: string}>}
 */
export async function buildDepositTx (orderDisplayId, driverWalletAddress, amountWei) {
  return measureExecution('EscrowService.buildDepositTx', async () => {
  const bookingId = getEscrowBookingId(orderDisplayId)
  if (!escrowContract) {
    return { txData: null, bookingId }
  }

  if (!ethers.isAddress(driverWalletAddress)) {
    return { txData: null, bookingId }
  }
  if (!amountWei || BigInt(amountWei) <= 0n) {
    return { txData: null, bookingId }
  }

  let txData
  try {
    txData = await escrowContract.createBooking.populateTransaction(
      bookingId,
      driverWalletAddress,
      {
        value: amountWei
      }
    )
  } catch (err) {
    logger.error(`[escrow] Failed to build deposit tx for booking ${orderDisplayId}: ${err.message}`)
    return { txData: null, bookingId, error: err.message }
  }
  logger.info(`[escrow] Deposit tx built for booking ${orderDisplayId}`)
  return { txData, bookingId }
  });
}

export async function recordDepositTx (bookingId, txHash, expectedSenderAddress = null) {
  return measureExecution('EscrowService.recordDepositTx', async () => {
  if (!escrowContract) {
    return { error: 'Contract not initialised' }
  }
  if (!ethers.isHexString(txHash, 32)) {
    return { error: 'Invalid transaction hash' }
  }

  // Idempotency: check if this booking already has a funded escrow on-chain
  try {
    const booking = await escrowContract.bookings(bookingId)
    if (booking && booking.amount > 0n) {
      logger.info(`[escrow] Booking ${bookingId} already has a funded escrow — idempotency skip.`)
      return { txHash, bookingId, alreadyFunded: true }
    }
  } catch (err) {
    logger.warn(`[escrow] Failed to check existing escrow status for ${bookingId}: ${err.message}, proceeding.`)
  }

  const provider = escrowContract.runner.provider
  const receipt = await provider.waitForTransaction(txHash, 1, 60_000)
  if (!receipt || receipt.status === 0) {
    return { error: 'Transaction reverted or not found on chain' }
  }

  const tx = await provider.getTransaction(txHash)
  if (!tx) {
    return { error: 'Transaction details not found' }
  }

  if (!tx.to || tx.to.toLowerCase() !== contractAddress.toLowerCase()) {
    return { error: 'Transaction destination is not the Escrow contract' }
  }

  let decoded
  try {
    decoded = escrowContract.interface.parseTransaction({ data: tx.data, value: tx.value })
  } catch (err) {
    return { error: 'Failed to parse transaction data' }
  }

  if (!decoded || decoded.name !== 'createBooking') {
    return { error: 'Transaction is not a createBooking call' }
  }

  const [txBookingId, txDriver] = decoded.args
  if (BigInt(txBookingId) !== BigInt(bookingId)) {
    return { error: 'Transaction booking ID does not match' }
  }

  // (No txCustomer argument in createBooking, so we skip that check).
  // We can still verify the on-chain sender (tx.from) is expected.

  // If an expected sender address was provided (from order record), verify it matches.
  // Reject if no wallet is on file rather than silently skipping sender verification (fail closed).
  if (!expectedSenderAddress) {
    return { error: 'No registered customer wallet on file to verify transaction sender against' }
  }
  if (tx.from.toLowerCase() !== expectedSenderAddress.toLowerCase()) {
    return { error: 'Transaction sender does not match the registered customer wallet for this order' }
  }

  logger.info(`[escrow] deposit confirmed for booking ${bookingId} in block ${receipt.blockNumber}`)
  return { txHash: receipt.hash, bookingId }
  });
}

/**
 * Release escrowed funds to the driver after successful delivery verification.
 * Must be called by an authorised relayer.
 *
 * @param {string} orderDisplayId
 * @returns {Promise<{txHash: string|null, bookingId: string}>}
 */
export async function escrowRelease (orderDisplayId) {
  return measureExecution('EscrowService.escrowRelease', async () => {
  const bookingId = getEscrowBookingId(orderDisplayId)

  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — skipping releaseFunds.')
    return { txHash: null, bookingId }
  }

  try {
    const booking = await escrowContract.bookings(bookingId)
    if (booking && booking.paid === true) {
      logger.info(`[escrow] Already released for booking ${orderDisplayId}, skipping.`)
      return { txHash: null, bookingId, alreadyReleased: true }
    }
  } catch (err) {
    logger.warn(`[escrow] Failed to check escrow status for ${orderDisplayId}: ${err.message}, proceeding with release.`)
  }

  try {
    const tx = await escrowContract.releasePayment(bookingId)
    logger.info(`[escrow] releasePayment tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
    const receipt = await tx.wait(1)
    logger.info(`[escrow] releaseFunds confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`)
    return { txHash: receipt.hash, bookingId }
  } catch (err) {
    logger.error(`[escrow] releaseFunds failed for booking ${orderDisplayId}: ${err.message}`)
    return { txHash: null, bookingId, error: err.message }
  }
  });
}

/**
 * Submit an escrow refund and return its hash before confirmation.
 */
export async function submitEscrowRefund (orderDisplayId) {
  return measureExecution('EscrowService.submitEscrowRefund', async () => {
  const bookingId = getEscrowBookingId(orderDisplayId)

  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — skipping refundFunds.')
    return { txHash: null, bookingId }
  }

  let tx
  try {
    tx = await escrowContract.cancelBooking(bookingId)
    logger.info(`[escrow] cancelBooking tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
  } catch (err) {
    logger.error(`[escrow] refundFunds failed for booking ${orderDisplayId}: ${err.message}`)
    return { txHash: null, bookingId, error: err.message }
  }
  return {
    txHash: tx.hash,
    bookingId,
    waitForConfirmation: async () => {
      const receipt = await tx.wait(1)
      if (!receipt || receipt.status === 0) {
        throw new Error('Escrow refund transaction reverted or was not found.')
      }
      logger.info(`[escrow] cancelBooking confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`)
      return receipt
    }
  }
  });
}

/**
 * Confirm a previously submitted refund transaction during a retry.
 */
export async function confirmEscrowRefund (txHash) {
  return measureExecution('EscrowService.confirmEscrowRefund', async () => {
  if (!escrowContract) {
    throw new Error('Escrow contract is not initialised.')
  }
  if (!ethers.isHexString(txHash, 32)) {
    throw new Error('Invalid escrow refund transaction hash.')
  }

  const receipt = await escrowContract.runner.provider.waitForTransaction(txHash, 1, 60_000)
  if (!receipt || receipt.status === 0) {
    throw new Error('Escrow refund transaction reverted or was not found.')
  }
  return receipt
  });
}

export function bookingIdFromUuid (orderId) {
  return getEscrowBookingId(orderId)
}

export async function releaseEscrowFunds (orderDisplayId) {
  return escrowRelease(orderDisplayId)
}

export async function escrowRefund (orderDisplayId) {
  return submitEscrowRefund(orderDisplayId)
}
