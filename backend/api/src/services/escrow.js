
class EscrowAmountMismatchError extends Error {
  constructor(expectedWei, actualWei) {
    super(`Escrow deposit amount mismatch: expected ${expectedWei} Wei, received ${actualWei} Wei.`);
    this.name = 'EscrowAmountMismatchError';
    this.code = 'ESCROW_AMOUNT_MISMATCH';
  }
}

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
 * prevent the relayer from bearing the escrow cost — but the call is only
 * valid with an owner-signed EIP-191 commitment binding the customer wallet,
 * bookingId, and a per-customer nonce, so a third party cannot front-run a
 * pending bookingId (issue #7734). buildDepositTx() mints that commitment.
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
  'function createBooking(uint256 bookingId, address payable driver, bytes signature) external payable',
  'function lockPayment(uint256 bookingId, address payable customer, address payable driver) external payable',
  'function commitmentNonces(address customer) external view returns (uint256)',
  'function releasePayment(uint256 bookingId) external',
  'function cancelBooking(uint256 bookingId) external',
  'function cancelWithPenalty(uint256 bookingId, uint256 driverFee) external',
  'function markBookingStarted(uint256 bookingId) external',
  'function raiseDispute(uint256 bookingId) external',
  'function resolveDispute(uint256 bookingId, uint256 driverAmount) external',
  'function resolveDisputeTimeout(uint256 bookingId) external',
  'function bookings(uint256 bookingId) external view returns (address customer, address driver, uint256 amount, uint8 status, bool paid, bool started, uint256 createdAt)'
]

const rpcUrl            = process.env.POLYGON_RPC_URL;
const contractAddress   = process.env.ESCROW_CONTRACT_ADDRESS;
const relayerPrivateKey = process.env.RELAYER_WALLET_PRIVATE_KEY;
function parseEnvFloat(raw, defaultVal, name) {
  const val = parseFloat(raw || defaultVal);
  if (Number.isNaN(val) || val <= 0) {
    throw new Error(`Invalid ${name}: "${raw}" — must be a positive number`);
  }
  return val;
}

export const ESCROW_MATIC_PER_PAISA = parseEnvFloat(process.env.ESCROW_MATIC_PER_PAISA, '0.000004', 'ESCROW_MATIC_PER_PAISA');
const MAX_ESCROW_MATIC = parseEnvFloat(process.env.MAX_ESCROW_MATIC, '100', 'MAX_ESCROW_MATIC');

/** @type {ethers.Contract | null} */
let escrowContract = null
/** @type {ethers.Wallet | null} */
let relayerWallet = null

if (rpcUrl && contractAddress && relayerPrivateKey) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    relayerWallet = new ethers.Wallet(relayerPrivateKey, provider);
    escrowContract = new ethers.Contract(contractAddress, ESCROW_ABI, relayerWallet);
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
 * Canonical wei-per-paisa scale derived from the configured escrow rate.
 * For the default ESCROW_MATIC_PER_PAISA=0.000004 this is exactly
 * 4_000_000_000_000n wei per paisa. All paisa↔wei conversions in the escrow
 * pipeline MUST use exact integer arithmetic (never floating point) so that
 * the amount the app records, the amount the customer deposits, and the
 * amount released to the driver can never diverge due to rounding.
 */
export const PAISA_WEI_SCALE = BigInt(Math.round(ESCROW_MATIC_PER_PAISA * 1e18));

/**
 * Tolerance (in wei) used when comparing amounts that may have been written
 * by different code versions. Stored escrow_amount_wei values written by the
 * legacy floating-point conversion deviate from the exact integer conversion
 * by at most ±256 wei for real order sizes (≤ ~250,000 paisa), far below
 * 1 gwei. A tolerance this large can never mask a real under/over-deposit.
 */
export const ESCROW_AMOUNT_TOLERANCE_WEI = 1_000_000_000n; // 1 gwei

/**
 * Convert an amount in paisa to its equivalent MATIC wei value using the
 * configured ESCROW_MATIC_PER_PAISA rate, with exact integer arithmetic.
 *
 * @param {number|string|bigint} paisa - Amount in paisa (e.g. 5000 = ₹50)
 * @returns {bigint} Amount in wei
 * @throws {RangeError} If paisa is negative, NaN, or exceeds safety cap
 */
export function paisaToMaticWei(paisa) {
  const numeric = Number(paisa);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new RangeError(`Invalid paisa amount: ${paisa}`);
  }
  const paisaBig = BigInt(Math.round(numeric));
  const maticWei = paisaBig * PAISA_WEI_SCALE;
  const maxMaticWei = BigInt(Math.round(MAX_ESCROW_MATIC * 1e18));
  if (maticWei > maxMaticWei) {
    const matic = maticWei / 1_000_000_000_000_000_000n;
    throw new RangeError(`Deposit ${matic} MATIC exceeds safety cap of ${MAX_ESCROW_MATIC} MATIC (${paisa} paisa @ ${ESCROW_MATIC_PER_PAISA} MATIC/paisa)`);
  }
  return maticWei;
}

/**
 * Convert an amount in wei back to paisa using the canonical scale.
 * Rounding is floored; intended for audit/display, not for authoritative
 * payout math (which must always derive from the integer paisa amount).
 *
 * @param {string|bigint|number} wei - Amount in wei
 * @returns {bigint} Amount in paisa
 */
export function maticWeiToPaisa(wei) {
  return BigInt(wei) / PAISA_WEI_SCALE;
}

/**
 * Whether |a - b| ≤ toleranceWei (both coerced to BigInt). Used to compare
 * the same monetary figure persisted by different code versions without
 * letting small legacy rounding differences block legit flows.
 *
 * @param {string|bigint|number} a
 * @param {string|bigint|number} b
 * @param {string|bigint|number} [toleranceWei] - default 1 gwei
 * @returns {boolean}
 */
export function weiWithinTolerance(a, b, toleranceWei = ESCROW_AMOUNT_TOLERANCE_WEI) {
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  const diff = aBig > bBig ? aBig - bBig : bBig - aBig;
  return diff <= BigInt(toleranceWei);
}

/**
 * Resolve the authoritative escrow deposit amount for an order and cross-check
 * the stored wei figure against the server-written bid-acceptance context.
 *
 * `orders.escrow_amount_wei` is the persisted authoritative figure, but it was
 * not client-write-protected before this work, so it is cross-checked against
 * `pending_bid_acceptance.bid_amount` (which IS server-write-protected). If the
 * two disagree beyond tolerance the row is treated as tampered and the deposit
 * is rejected (fail closed) rather than trusting either value.
 *
 * @param {object} order - Order row with escrow_amount_wei / pending_bid_acceptance
 * @returns {{expectedAmountWei: bigint} | {error: string, code: string}}
 */
export function resolveExpectedDepositAmount(order) {
  const storedWei = order?.escrow_amount_wei;
  const pendingBidAmount = order?.pending_bid_acceptance?.bid_amount;

  if (storedWei != null && pendingBidAmount != null) {
    let stored;
    try {
      stored = BigInt(storedWei);
    } catch (err) {
      return { error: 'Escrow amount on file is not a valid integer', code: 'ESCROW_AMOUNT_INVALID' };
    }
    const fromBid = paisaToMaticWei(pendingBidAmount);
    if (!weiWithinTolerance(stored, fromBid)) {
      return {
        error: `Escrow amount on file (${stored} wei) is inconsistent with the accepted bid (${pendingBidAmount} paisa = ${fromBid} wei).`,
        code: 'ESCROW_AMOUNT_INCONSISTENT',
      };
    }
    return { expectedAmountWei: stored };
  }

  if (storedWei != null) {
    try {
      return { expectedAmountWei: BigInt(storedWei) };
    } catch (err) {
      return { error: 'Escrow amount on file is not a valid integer', code: 'ESCROW_AMOUNT_INVALID' };
    }
  }

  if (pendingBidAmount != null) {
    return { expectedAmountWei: paisaToMaticWei(pendingBidAmount) };
  }

  return { error: 'No escrow amount is recorded for this order. Deposit cannot be verified.', code: 'ESCROW_AMOUNT_MISSING' };
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
 * Query the escrow contract's bookings mapping for a given booking ID.
 * Used by escrowFundingReconciliation and the release reconciler to check
 * the authoritative on-chain booking state.
 * Used by escrowFundingReconciliation and the payout amount checks to read
 * the authoritative on-chain state for a booking.
 *
 * @param {string} escrowBookingId — bytes32 hash (result of getEscrowBookingId)
 * @returns {Promise<{customer: string, driver: string, amount: bigint, status: number, paid: boolean, started: boolean, createdAt: bigint} | null>}
 */
export async function getEscrowBooking(escrowBookingId) {
  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — cannot query bookings.');
    return null;
  }

  if (!ethers.isHexString(escrowBookingId, 32)) {
    logger.warn('[escrow] Invalid escrowBookingId format — cannot query bookings.');
    return null;
  }

  try {
    const booking = await escrowContract.bookings(escrowBookingId);
    return booking;
  } catch (err) {
    logger.error(`[escrow] getEscrowBooking failed: ${err.message}`);
    return null;
  }
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
 * @param {string} customerWalletAddress — 0x-prefixed Polygon address of the customer (the signer of the deposit tx)
 * @param {string} driverWalletAddress   — 0x-prefixed Polygon address of the driver
 * @param {string} amountWei             — amount in wei (string or bigint)
 * @returns {Promise<{txData: object|null, bookingId: string}>}
 */
export async function buildDepositTx (orderDisplayId, customerWalletAddress, driverWalletAddress, amountWei) {
  return measureExecution('EscrowService.buildDepositTx', async () => {
  const bookingId = getEscrowBookingId(orderDisplayId)
  if (!escrowContract) {
    return { txData: null, bookingId }
  }

  if (!ethers.isAddress(driverWalletAddress) || !ethers.isAddress(customerWalletAddress)) {
    return { txData: null, bookingId }
  }
  if (!amountWei || BigInt(amountWei) <= 0n) {
    return { txData: null, bookingId }
  }

  let txData
  try {
    // Owner-signed EIP-191 commitment binding chain, contract, customer,
    // bookingId and the customer's next nonce. Without it the contract
    // rejects createBooking, so a third party cannot front-run the slot
    // (issue #7734).
    const network = await escrowContract.runner.provider.getNetwork()
    const nonce = await escrowContract.commitmentNonces(customerWalletAddress)
    const commitment = ethers.solidityPackedKeccak256(
      ['uint256', 'address', 'address', 'uint256', 'uint256'],
      [network.chainId, contractAddress, customerWalletAddress, bookingId, nonce]
    )
    const signature = await relayerWallet.signMessage(ethers.getBytes(commitment))

    txData = await escrowContract.createBooking.populateTransaction(
      bookingId,
      driverWalletAddress,
      signature,
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

/**
 * Wait for an on-chain deposit transaction to be confirmed and verify its details.
 *
 * @param {string} bookingId
 * @param {string} txHash
 * @param {string|null} expectedSenderAddress
 * @param {string|null} expectedDriverAddress
 * @param {string|null} expectedAmountWei
 * @returns {Promise<{txHash?: string, bookingId?: string, error?: string, alreadyFunded?: boolean}>}
 */
export async function recordDepositTx (bookingId, txHash, expectedSenderAddress = null, expectedDriverAddress = null, expectedAmountWei = null) {
  return measureExecution('EscrowService.recordDepositTx', async () => {
  if (!escrowContract) {
    return { error: 'Contract not initialised' }
  }
  if (!ethers.isHexString(txHash, 32)) {
    return { error: 'Invalid transaction hash' }
  }

  // Idempotency: check if this booking already has a funded escrow on-chain.
  // createBooking now requires an owner-signed commitment (issue #7734), but an
  // already-existing booking is still verified to have been created by the
  // registered customer — and, when the expected values are persisted on the
  // order, for the assigned driver and for at least the expected escrow amount
  // — before it is accepted as funded.
  try {
    const booking = await escrowContract.bookings(bookingId)
    if (booking && booking.amount > 0n) {
      if (!expectedSenderAddress) {
        return { error: 'No registered customer wallet on file to verify transaction sender against' }
      }
      if (booking.customer.toLowerCase() !== expectedSenderAddress.toLowerCase()) {
        return { error: 'Existing booking was created by a different wallet than the registered customer for this order' }
      }
      if (expectedDriverAddress && booking.driver.toLowerCase() !== expectedDriverAddress.toLowerCase()) {
        return { error: 'Existing booking was created for a different driver than the one assigned to this order' }
      }
      if (expectedAmountWei !== null && booking.amount !== BigInt(expectedAmountWei)) {
        return {
          error: `Existing booking amount (${booking.amount} wei) does not match the expected escrow amount (${BigInt(expectedAmountWei)} wei) of this order`,
          code: 'DEPOSIT_AMOUNT_MISMATCH',
        }
      }
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
  let bookingIdMatches
  try {
    bookingIdMatches = BigInt(txBookingId) === BigInt(bookingId)
  } catch (err) {
    return { error: 'Invalid booking ID format' }
  }
  if (!bookingIdMatches) {
    return { error: 'Transaction booking ID does not match' }
  }

  // Verify the on-chain sender (tx.from) is the registered customer wallet.
  // Reject if no wallet is on file rather than silently skipping sender verification (fail closed).
  if (!expectedSenderAddress) {
    return { error: 'No registered customer wallet on file to verify transaction sender against' }
  }
  if (tx.from.toLowerCase() !== expectedSenderAddress.toLowerCase()) {
    return { error: 'Transaction sender does not match the registered customer wallet for this order' }
  }

  // Verify the booking was created for the assigned driver and funded with
  // EXACTLY the expected escrow amount when those are persisted for the
  // order. Exact equality (not >=) rejects both under- and over-payments:
  // a client that deposits Y ≠ X against an accepted bid of X must not be
  // allowed to re-anchor the payout amount.
  if (expectedDriverAddress && txDriver.toLowerCase() !== expectedDriverAddress.toLowerCase()) {
    return { error: 'Transaction driver address does not match the assigned driver for this order' }
  }
  if (expectedAmountWei !== null && BigInt(tx.value) !== BigInt(expectedAmountWei)) {
    const direction = BigInt(tx.value) < BigInt(expectedAmountWei) ? 'less than' : 'greater than';
    return {
      error: `Transaction value (${BigInt(tx.value)} wei) does not match the expected escrow amount (${BigInt(expectedAmountWei)} wei) for this order — deposited amount is ${direction} expected`,
      code: 'DEPOSIT_AMOUNT_MISMATCH',
    }
  }

  logger.info(`[escrow] deposit confirmed for booking ${bookingId} in block ${receipt.blockNumber}`)
  return { txHash: receipt.hash, bookingId }
  });
}

/**
 * Mark an escrow booking as started on-chain once the trip has begun, so
 * cancelBooking / cancelWithPenalty revert and a full refund is blocked
 * (issue #5768).
 *
 * @param {string} orderDisplayId
 * @returns {Promise<{txHash: string|null, bookingId: string, waitForConfirmation?: Function, error?: string}>}
 */
export async function markEscrowBookingStarted (orderDisplayId) {
  return measureExecution('EscrowService.markEscrowBookingStarted', async () => {
  const bookingId = getEscrowBookingId(orderDisplayId)

  if (!escrowContract) {
    logger.warn('[escrow] Contract not initialised — skipping markBookingStarted.')
    return { txHash: null, bookingId }
  }

  try {
    const tx = await escrowContract.markBookingStarted(bookingId)
    logger.info(`[escrow] markBookingStarted tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
    return {
      txHash: tx.hash,
      bookingId,
      waitForConfirmation: async () => {
        const receipt = await tx.wait(1)
        if (!receipt || receipt.status === 0) {
          throw new Error('Escrow markBookingStarted transaction reverted or was not found.')
        }
        logger.info(`[escrow] markBookingStarted confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`)
        return receipt
      },
    }
  } catch (err) {
    logger.error(`[escrow] markBookingStarted failed for booking ${orderDisplayId}: ${err.message}`)
    return { txHash: null, bookingId, error: err.message }
  }
  });
}

/**
 * Release escrowed funds to the driver after successful delivery verification.
 * Must be called by an authorised relayer.
 *
 * Payout defense-in-depth: when `expectedAmountWei` is provided, the on-chain
 * booking amount is verified against it BEFORE the release transaction is
 * submitted. A booking funded with an amount that does not match the app's
 * authoritative amount is never released — the funds stay locked so the
 * anomaly can be resolved instead of paying the driver a wrong amount.
 *
 * @param {string} orderDisplayId
 * @param {string|bigint|null} [expectedAmountWei] - authoritative app amount
 * @returns {Promise<{txHash: string|null, bookingId: string, alreadyReleased?: boolean, error?: string, code?: string}>}
 */
export async function escrowRelease (orderDisplayId, expectedAmountWei = null) {
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
    if (booking && expectedAmountWei !== null && booking.amount !== BigInt(expectedAmountWei)) {
      logger.error(
        `[escrow] Booking ${orderDisplayId} amount (${booking.amount} wei) does not match expected ${BigInt(expectedAmountWei)} wei — refusing to release.`
      )
      return {
        txHash: null,
        bookingId,
        error: `On-chain booking amount (${booking.amount} wei) does not match the expected escrow amount (${BigInt(expectedAmountWei)} wei). Refusing to release payment.`,
        code: 'DEPOSIT_AMOUNT_MISMATCH',
      }
    }
  } catch (err) {
    logger.error(`[escrow] Failed to check escrow status for ${orderDisplayId}: ${err.message}`)
    return {
      txHash: null,
      bookingId,
      error: err.message,
      code: 'ESCROW_STATUS_UNAVAILABLE',
    }
  }

  try {
    const tx = await escrowContract.releasePayment(bookingId)
    logger.info(`[escrow] releasePayment tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
    const receipt = await tx.wait(1)
    if (!receipt || receipt.status === 0) {
      logger.error(`[escrow] releasePayment reverted or not found for booking ${orderDisplayId}`)
      return { txHash: null, bookingId, error: 'release reverted' }
    }
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

/**
 * Lock payment in escrow for a specific booking.
 *
 * @param {string} orderDisplayId
 * @param {string} customerWalletAddress
 * @param {string} driverWalletAddress
 * @param {string} amountWei
 * @returns {Promise<{txHash: string|null, bookingId: string, error?: string}>}
 */
export async function escrowLockPayment(orderDisplayId, customerWalletAddress, driverWalletAddress, amountWei) {
  return measureExecution('EscrowService.escrowLockPayment', async () => {
    const bookingId = getEscrowBookingId(orderDisplayId);

    if (!escrowContract) {
      logger.warn('[escrow] Contract not initialised — skipping lockPayment.');
      return { txHash: null, bookingId };
    }

    try {
      const tx = await escrowContract.lockPayment(
        bookingId,
        customerWalletAddress,
        driverWalletAddress,
        {
          value: amountWei
        }
      );
      logger.info(`[escrow] lockPayment tx submitted: ${tx.hash} for booking ${orderDisplayId}`);
      const receipt = await tx.wait(1);
      logger.info(`[escrow] lockPayment confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`);
      return { txHash: receipt.hash, bookingId };
    } catch (err) {
      logger.error(`[escrow] lockPayment failed for booking ${orderDisplayId}: ${err.message}`);
      return { txHash: null, bookingId, error: err.message };
    }
  });
}


/**
 * Submit an escrow cancellation with a penalty fee awarded to the driver.
 *
 * @param {string} orderDisplayId
 * @param {string|bigint} driverFeeWei
 * @returns {Promise<{txHash: string|null, bookingId: string, error?: string, waitForConfirmation?: Function}>}
 */
export async function submitEscrowCancelWithPenalty (orderDisplayId, driverFeeWei) {
  return measureExecution('EscrowService.submitEscrowCancelWithPenalty', async () => {
    const bookingId = getEscrowBookingId(orderDisplayId)

    if (!escrowContract) {
      logger.warn('[escrow] Contract not initialised — skipping cancelWithPenalty.')
      return { txHash: null, bookingId }
    }

    try {
      const tx = await escrowContract.cancelWithPenalty(bookingId, driverFeeWei)
      logger.info(`[escrow] cancelWithPenalty tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
      return {
        txHash: tx.hash,
        bookingId,
        waitForConfirmation: async () => {
          const receipt = await tx.wait(1)
          if (!receipt || receipt.status === 0) {
            throw new Error('Escrow cancelWithPenalty transaction reverted or was not found.')
          }
          return receipt
        },
      }
    } catch (err) {
      logger.error(`[escrow] cancelWithPenalty failed for booking ${orderDisplayId}: ${err.message}`)
      return { txHash: null, bookingId, error: err.message }
    }
  })
}


/**
 * Submit an escrow dispute raise and return its hash before confirmation.
 * Only the relayer (owner) may call raiseDispute on-chain.
 */
export async function submitEscrowRaiseDispute (orderDisplayId) {
  return measureExecution('EscrowService.submitEscrowRaiseDispute', async () => {
    const bookingId = getEscrowBookingId(orderDisplayId)

    if (!escrowContract) {
      logger.warn('[escrow] Contract not initialised — skipping raiseDispute.')
      return { txHash: null, bookingId }
    }

    let tx
    try {
      tx = await escrowContract.raiseDispute(bookingId)
      logger.info(`[escrow] raiseDispute tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
    } catch (err) {
      logger.error(`[escrow] raiseDispute failed for booking ${orderDisplayId}: ${err.message}`)
      return { txHash: null, bookingId, error: err.message }
    }
    return {
      txHash: tx.hash,
      bookingId,
      waitForConfirmation: async () => {
        const receipt = await tx.wait(1)
        if (!receipt || receipt.status === 0) {
          throw new Error('Escrow raiseDispute transaction reverted or was not found.')
        }
        logger.info(`[escrow] raiseDispute confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`)
        return receipt
      }
    }
  })
}

/**
 * Submit a dispute resolution that splits the escrowed funds. driverAmountWei
 * is awarded to the driver; the remainder is refunded to the customer.
 * Only the relayer (owner) may call resolveDispute on-chain.
 *
 * @param {string} orderDisplayId
 * @param {string|bigint} driverAmountWei — wei awarded to the driver
 */
export async function submitEscrowResolveDispute (orderDisplayId, driverAmountWei) {
  return measureExecution('EscrowService.submitEscrowResolveDispute', async () => {
    const bookingId = getEscrowBookingId(orderDisplayId)

    if (!escrowContract) {
      logger.warn('[escrow] Contract not initialised — skipping resolveDispute.')
      return { txHash: null, bookingId }
    }

    let tx
    try {
      tx = await escrowContract.resolveDispute(bookingId, driverAmountWei)
      logger.info(`[escrow] resolveDispute tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
    } catch (err) {
      logger.error(`[escrow] resolveDispute failed for booking ${orderDisplayId}: ${err.message}`)
      return { txHash: null, bookingId, error: err.message }
    }
    return {
      txHash: tx.hash,
      bookingId,
      waitForConfirmation: async () => {
        const receipt = await tx.wait(1)
        if (!receipt || receipt.status === 0) {
          throw new Error('Escrow resolveDispute transaction reverted or was not found.')
        }
        logger.info(`[escrow] resolveDispute confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`)
        return receipt
      }
    }
  })
}

/**
 * Submit a dispute-timeout resolution that refunds the customer in full.
 * Only the relayer (owner) may call resolveDisputeTimeout on-chain.
 */
export async function submitEscrowResolveDisputeTimeout (orderDisplayId) {
  return measureExecution('EscrowService.submitEscrowResolveDisputeTimeout', async () => {
    const bookingId = getEscrowBookingId(orderDisplayId)

    if (!escrowContract) {
      logger.warn('[escrow] Contract not initialised — skipping resolveDisputeTimeout.')
      return { txHash: null, bookingId }
    }

    let tx
    try {
      tx = await escrowContract.resolveDisputeTimeout(bookingId)
      logger.info(`[escrow] resolveDisputeTimeout tx submitted: ${tx.hash} for booking ${orderDisplayId}`)
    } catch (err) {
      logger.error(`[escrow] resolveDisputeTimeout failed for booking ${orderDisplayId}: ${err.message}`)
      return { txHash: null, bookingId, error: err.message }
    }
    return {
      txHash: tx.hash,
      bookingId,
      waitForConfirmation: async () => {
        const receipt = await tx.wait(1)
        if (!receipt || receipt.status === 0) {
          throw new Error('Escrow resolveDisputeTimeout transaction reverted or was not found.')
        }
        logger.info(`[escrow] resolveDisputeTimeout confirmed for booking ${orderDisplayId} in block ${receipt.blockNumber}`)
        return receipt
      }
    }
  })
}
export const lockPayment = escrowLockPayment;



async function verifyOnChainEscrowBalance(bookingId, expectedWei) {
  const bookingOnChain = await escrowContract.bookings(bookingId);
  const onChainAmountBN = BigInt(bookingOnChain.amount.toString());
  const expectedWeiBN = BigInt(expectedWei);
  return {
    valid: onChainAmountBN >= expectedWeiBN,
    onChainAmount: onChainAmountBN.toString(),
    expectedAmount: expectedWeiBN.toString()
  };
}

module.exports.verifyOnChainEscrowBalance = verifyOnChainEscrowBalance;
