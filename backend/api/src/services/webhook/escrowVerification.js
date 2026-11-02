import { ethers } from 'ethers';
import { getEscrowBookingId, weiWithinTolerance } from '../escrow.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import logger from '../../middleware/logger.js';

// Canonical PaymentReleased event fragment — MUST match the fragment used by
// the escrow contract (see ESCROW_EVENTS in services/escrow.js). Changes here
// break on-chain correlation for release webhooks.
const PAYMENT_RELEASED_IFACE = new ethers.Interface([
  'event PaymentReleased(uint256 indexed bookingId, address indexed driver, uint256 paymentAmount)',
]);

const PAYMENT_RELEASED_TOPIC = PAYMENT_RELEASED_IFACE.getEvent('PaymentReleased').topicHash;

const DEFAULT_REQUIRED_CONFIRMATIONS = 1;

// Tolerances match services/escrow.js (weiWithinTolerance).
const AMOUNT_TOLERANCE_WEI = 1_000_000_000n;

// Default RPC timeout for a single on-chain verification call. Overridable via
// ESCROW_VERIFICATION_RPC_TIMEOUT_MS (see .env.example). A finite timeout is
// mandatory so a hung provider never stalls the webhook worker indefinitely.
const DEFAULT_RPC_TIMEOUT_MS = 10_000;

function requiredConfirmations() {
  const raw = Number(process.env.ESCROW_RELEASE_CONFIRMATIONS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_REQUIRED_CONFIRMATIONS;
}

function rpcTimeoutMs() {
  const raw = Number(process.env.ESCROW_VERIFICATION_RPC_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_RPC_TIMEOUT_MS;
}

/**
 * Error thrown when on-chain verification of an escrow webhook transaction
 * fails.
 *
 * `retryable` decides whether the DLQ will schedule another attempt:
 *  - retryable=true   -> transient (RPC down, tx pending, receipt not indexed)
 *  - retryable=false  -> permanent (bad payload, wrong order, replay, failed tx)
 */
export class EscrowVerificationError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'EscrowVerificationError';
    this.code = code;
    this.retryable = options.retryable !== false;
  }
}

/**
 * Validate and normalize a transaction hash for escrow verification.
 * Accepts only a full 32-byte hex hash (0x + 64 hex chars); any other shape
 * (addresses, short hashes, hex numbers) is rejected.
 * @param {string} txHash
 * @returns {string|null} normalized lowercase hash, or null when invalid
 */
export function normalizeTxHash(txHash) {
  if (typeof txHash !== 'string') return null;
  const trimmed = txHash.trim();
  if (!ethers.isHexString(trimmed, 32)) return null;
  return trimmed.toLowerCase();
}

function escrowContractAddress() {
  const address = process.env.ESCROW_CONTRACT_ADDRESS;
  if (!address || !ethers.isAddress(address)) {
    throw new EscrowVerificationError(
      'BLOCKCHAIN_NOT_CONFIGURED',
      'ESCROW_CONTRACT_ADDRESS is not configured; cannot verify escrow webhook on-chain',
      { retryable: false },
    );
  }
  return address.toLowerCase();
}

function rpcProvider() {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) {
    throw new EscrowVerificationError(
      'BLOCKCHAIN_NOT_CONFIGURED',
      'POLYGON_RPC_URL is not configured; cannot verify escrow webhook on-chain',
      { retryable: false },
    );
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Strip anything URL-like from a provider message before it reaches logs so an
 * API-key-bearing RPC endpoint (e.g. .../v2/YOUR_KEY) can never be written out
 * even to internal logs.
 */
function sanitizeProviderMessage(raw) {
  return String(raw || '')
    .replace(/https?:\/\/[^\s'"\]]+/g, '[rpc-url-redacted]')
    .slice(0, 500);
}

/**
 * Classify a raw provider failure into a retryable, caller-safe
 * EscrowVerificationError. Raw provider messages are never propagated because
 * they can leak RPC URLs / internal transport details to webhook clients and
 * are not stable enough for operator triage.
 */
function classifyProviderError(err, step) {
  const detail = sanitizeProviderMessage(`${err?.message || err?.code || ''}`);
  if (/rate.?limit|429|too many requests|throttl|limit exceeded|max.?rate/i.test(detail)) {
    return new EscrowVerificationError(
      'RPC_RATE_LIMITED',
      `Polygon RPC rate limit hit while verifying transaction (${step})`,
      { retryable: true },
    );
  }
  return new EscrowVerificationError(
    'RPC_ERROR',
    `Polygon RPC request failed while verifying transaction (${step})`,
    { retryable: true },
  );
}

/**
 * Run a single JsonRpcProvider call under a hard timeout and translate any raw
 * provider error (timeout, connection failure, rate limiting, malformed
 * response, provider unavailable) into a retryable EscrowVerificationError.
 *
 * RPC failures never count as successful verification — the DLQ/retry layer
 * decides whether to schedule another attempt based on `retryable`.
 */
async function callProvider(provider, method, args, step) {
  const timeoutMs = rpcTimeoutMs();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new EscrowVerificationError(
          'RPC_TIMEOUT',
          `Polygon RPC timed out while verifying transaction (${step}) after ${timeoutMs}ms`,
          { retryable: true },
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([provider[method](...args), timeout]);
  } catch (err) {
    if (err instanceof EscrowVerificationError) throw err;
    logger.warn(
      { rpcStep: step, providerError: sanitizeProviderMessage(err?.message) },
      '[escrow-verification] Polygon RPC request failed',
    );
    throw classifyProviderError(err, step);
  } finally {
    clearTimeout(timer);
  }
}

function destroyProvider(provider) {
  try {
    if (provider && typeof provider.destroy === 'function') {
      provider.destroy();
    }
  } catch (err) {
    logger.debug(`[escrow-verification] Failed to dispose RPC provider: ${err?.message}`);
  }
}

function findPaymentReleasedEvents(receipt, escrowAddress) {
  const logs = receipt && Array.isArray(receipt.logs) ? receipt.logs : [];
  const events = [];
  for (const log of logs) {
    if (!log || typeof log.address !== 'string') continue;
    if (log.address.toLowerCase() !== escrowAddress) continue;
    const topics = log.topics || [];
    if (!topics[0] || topics[0].toLowerCase() !== PAYMENT_RELEASED_TOPIC) continue;
    try {
      const parsed = PAYMENT_RELEASED_IFACE.parseLog(log);
      if (parsed) {
        events.push({
          bookingId: parsed.args.bookingId,
          driver: parsed.args.driver,
          amount: parsed.args.paymentAmount,
        });
      }
    } catch (err) {
      logger.warn(`[escrow-verification] Failed to parse PaymentReleased log: ${err?.message}`);
    }
  }
  return events;
}

/**
 * Verify an escrow webhook transaction on Polygon before any state change.
 *
 * Guarantees, in order:
 *   1. txHash is a well-formed 32-byte transaction hash.
 *   2. The transaction exists, is mined, and succeeded (status=1).
 *   3. The transaction targeted the configured escrow contract.
 *   4. The transaction has the required confirmations.
 *   5. (release path) The receipt emits PaymentReleased for THIS order's
 *      bookingId, so a webhook for one order cannot release another order.
 *   6. (release path, optional) The released amount matches the expected
 *      escrow amount within tolerance.
 *
 * A driver-wallet mismatch is logged but NOT fatal: bookingId correlation is
 * the authoritative binding between a transaction and an order.
 *
 * @param {object} params
 * @param {string} params.txHash
 * @param {string} [params.orderDisplayId] required for the release path
 * @param {string} [params.driverWalletAddress] soft-check, logged only
 * @param {string|number|bigint} [params.expectedAmountWei] amount tolerance check
 * @param {boolean} [params.requirePaymentReleased=true] false for withdrawal txs
 * @returns {Promise<object>} { ok, txHash, blockNumber, confirmations, ... }
 */
export async function verifyPolygonEscrowTransaction(params) {
  return measureExecution('EscrowVerification.verifyPolygonEscrowTransaction', async () => {
    // Guard order preserved: txHash shape first, then contract config, then RPC.
    const txHash = normalizeTxHash(params?.txHash);
    if (!txHash) {
      throw new EscrowVerificationError(
        'INVALID_TX_HASH',
        'Escrow webhook requires a well-formed 32-byte transaction hash (0x + 64 hex chars)',
        { retryable: false },
      );
    }

    const escrowAddress = escrowContractAddress();
    const provider = rpcProvider();
    try {
      return await verifyWithProvider({ ...(params || {}), txHash, escrowAddress }, provider);
    } finally {
      destroyProvider(provider);
    }
  });
}

/**
 * Core verification against a live provider. Never returns a misleading
 * success: every on-chain guarantee must hold before `ok: true` is produced.
 */
async function verifyWithProvider(params, provider) {
  const {
    txHash,
    escrowAddress,
    orderDisplayId,
    driverWalletAddress,
    expectedAmountWei,
    requirePaymentReleased = true,
  } = params;

  // 1. Transaction exists and is mined.
  const tx = await callProvider(provider, 'getTransaction', [txHash], 'getTransaction');
  if (!tx) {
    throw new EscrowVerificationError(
      'TRANSACTION_NOT_FOUND',
      `Polygon transaction not found for ${txHash}`,
      { retryable: true },
    );
  }
  if (!tx.blockNumber) {
    throw new EscrowVerificationError(
      'TRANSACTION_PENDING',
      `Polygon transaction ${txHash} is still pending`,
      { retryable: true },
    );
  }

  // 2. Transaction targeted the escrow contract.
  if (!tx.to || tx.to.toLowerCase() !== escrowAddress) {
    throw new EscrowVerificationError(
      'WRONG_CONTRACT',
      `Transaction ${txHash} does not target the escrow contract ${escrowAddress}`,
      { retryable: false },
    );
  }

  // 3. Receipt succeeded.
  const receipt = await callProvider(provider, 'getTransactionReceipt', [txHash], 'getTransactionReceipt');
  if (!receipt) {
    throw new EscrowVerificationError(
      'RECEIPT_NOT_FOUND',
      `Polygon transaction receipt not found for ${txHash}`,
      { retryable: true },
    );
  }
  if (Number(receipt.status) !== 1) {
    throw new EscrowVerificationError(
      'TRANSACTION_FAILED',
      `Polygon transaction ${txHash} reverted (status=${receipt.status})`,
      { retryable: false },
    );
  }
  if (!receipt.to || receipt.to.toLowerCase() !== escrowAddress) {
    throw new EscrowVerificationError(
      'WRONG_CONTRACT',
      `Transaction receipt for ${txHash} is not from the escrow contract ${escrowAddress}`,
      { retryable: false },
    );
  }
  if (!Number.isFinite(Number(receipt.blockNumber)) || Number(receipt.blockNumber) < 0) {
    throw new EscrowVerificationError(
      'RECEIPT_INVALID',
      `Polygon transaction receipt for ${txHash} has no valid block number`,
      { retryable: true },
    );
  }

  // 4. Confirmations.
  const currentBlock = await callProvider(provider, 'getBlockNumber', [], 'getBlockNumber');
  if (!Number.isFinite(Number(currentBlock)) || Number(currentBlock) < 0) {
    throw new EscrowVerificationError(
      'RPC_ERROR',
      `Polygon RPC returned an invalid block height while verifying transaction (${txHash})`,
      { retryable: true },
    );
  }
  const confirmations = currentBlock - Number(receipt.blockNumber) + 1;
  const needed = requiredConfirmations();
  if (confirmations < needed) {
    throw new EscrowVerificationError(
      'INSUFFICIENT_CONFIRMATIONS',
      `Transaction ${txHash} has ${confirmations} confirmation(s); ${needed} required`,
      { retryable: true },
    );
  }

  const verified = {
    ok: true,
    txHash,
    blockNumber: Number(receipt.blockNumber),
    confirmations,
    contractAddress: escrowAddress,
  };

  if (!requirePaymentReleased) {
    logger.info(`[escrow-verification] Transaction ${txHash} verified against escrow contract (withdrawal path)`);
    return verified;
  }

  // 5. PaymentReleased event must match THIS order's booking.
  if (!orderDisplayId) {
    throw new EscrowVerificationError(
      'INVALID_PAYLOAD',
      'PaymentReleased verification requires orderDisplayId for booking correlation',
      { retryable: false },
    );
  }
  const events = findPaymentReleasedEvents(receipt, escrowAddress);
  if (events.length === 0) {
    throw new EscrowVerificationError(
      'PAYMENT_RELEASED_EVENT_NOT_FOUND',
      `Transaction ${txHash} did not emit a PaymentReleased event`,
      { retryable: false },
    );
  }

  let expectedBookingId;
  try {
    expectedBookingId = getEscrowBookingId(orderDisplayId);
  } catch (err) {
    throw new EscrowVerificationError(
      'INVALID_PAYLOAD',
      `Order ${orderDisplayId} has no valid escrow booking id`,
      { retryable: false },
    );
  }
  const expectedBookingBigInt = BigInt(expectedBookingId);

  // A batch release transaction can emit one PaymentReleased event per
  // booking. Selecting only the first log rejected a valid webhook whenever
  // another booking's event came first. Match the event that belongs to this
  // order instead.
  let event = null;
  let eventBookingId = null;
  let eventAmount = null;
  let malformedEvent = null;
  for (const candidate of events) {
    try {
      const candidateBookingId = BigInt(candidate.bookingId);
      const candidateAmount = BigInt(candidate.amount);
      if (candidateBookingId === expectedBookingBigInt) {
        event = candidate;
        eventBookingId = candidateBookingId;
        eventAmount = candidateAmount;
        break;
      }
    } catch (err) {
      malformedEvent = candidate;
    }
  }

  if (!event) {
    if (malformedEvent) {
      throw new EscrowVerificationError(
        'EVENT_DATA_INVALID',
        `PaymentReleased event in ${txHash} has invalid bookingId/amount data`,
        { retryable: false },
      );
    }
    throw new EscrowVerificationError(
      'ORDER_MISMATCH',
      `PaymentReleased events in ${txHash} do not belong to ${orderDisplayId}`,
      { retryable: false },
    );
  }

  // 6. Amount tolerance (only when we know the expected amount).
  if (expectedAmountWei != null) {
    let expected;
    try {
      expected = BigInt(expectedAmountWei);
    } catch (err) {
      throw new EscrowVerificationError(
        'EVENT_DATA_INVALID',
        `Expected escrow amount for ${orderDisplayId} is not a valid integer`,
        { retryable: false },
      );
    }
    if (
      expected > 0n &&
      (eventAmount < expected - AMOUNT_TOLERANCE_WEI || eventAmount > expected + AMOUNT_TOLERANCE_WEI)
    ) {
      throw new EscrowVerificationError(
        'AMOUNT_MISMATCH',
        `PaymentReleased amount ${eventAmount} for ${orderDisplayId} does not match expected ${expected} (wei)`,
        { retryable: false },
      );
    }
  }

  // 7. Driver wallet soft-check (bookingId correlation is authoritative).
  if (driverWalletAddress && ethers.isAddress(driverWalletAddress)) {
    if (driverWalletAddress.toLowerCase() !== event.driver.toLowerCase()) {
      logger.warn(
        `[escrow-verification] Driver wallet mismatch for order ${orderDisplayId}: ` +
          `event driver ${event.driver} vs recorded ${driverWalletAddress} — bookingId correlation is authoritative`,
      );
    }
  }

  verified.eventName = 'PaymentReleased';
  verified.orderDisplayId = orderDisplayId;
  verified.driver = event.driver;
  verified.amount = eventAmount.toString();
  verified.bookingId = expectedBookingId;

  logger.info(
    `[escrow-verification] PaymentReleased verified for order ${orderDisplayId} (tx: ${txHash}, block: ${verified.blockNumber}, confirmations: ${confirmations}, amount: ${verified.amount})`,
  );
  return verified;
}

/**
 * Receipt-level verification for withdrawal webhooks (WithdrawalReady/Withdrawn).
 * These transactions do not emit PaymentReleased, so no booking correlation.
 */
export function verifyPolygonWithdrawalTransaction(params) {
  return verifyPolygonEscrowTransaction({ ...params, requirePaymentReleased: false });
}

export { requiredConfirmations };
