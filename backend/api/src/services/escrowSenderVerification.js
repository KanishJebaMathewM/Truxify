/**
 * Escrow Sender Verification Service
 *
 * Verifies transaction sender addresses against registered customer/wallet addresses
 * for escrow deposits and operations, preventing spoofing and unauthorized interactions.
 */
import { ethers } from 'ethers';
import logger from '../middleware/logger.js';

/**
 * Normalizes an address or extracts address from a sender object.
 * Returns null if input is invalid.
 *
 * @param {string|object} sender
 * @returns {string|null}
 */
export function extractSenderAddress(sender) {
  if (!sender) return null;

  let rawAddress = null;
  if (typeof sender === 'string') {
    rawAddress = sender.trim();
  } else if (typeof sender === 'object') {
    rawAddress = sender.address || sender.walletAddress || sender.from || null;
  }

  if (typeof rawAddress === 'string' && rawAddress.trim() !== '') {
    const trimmed = rawAddress.trim();
    const lower = trimmed.toLowerCase();
    if (ethers.isAddress(lower)) {
      return lower;
    }
  }

  return null;
}

/**
 * Verifies that an escrow sender matches the expected wallet address.
 *
 * @param {string|object} sender - The sender address or transaction/sender object
 * @param {string} expectedAddress - The registered expected customer/sender address
 * @param {object} [options={}] - Additional verification options
 * @returns {{ valid: boolean, success: boolean, sender?: string, expected?: string, error?: string, code?: string }}
 */
export function verifyEscrowSender(sender, expectedAddress, options = {}) {
  // Explicit guard for null/undefined/falsy sender
  if (!sender) {
    logger.debug('[EscrowSenderVerification] Sender is null or undefined');
    return {
      valid: false,
      success: false,
      error: 'Sender is required and cannot be null or undefined',
      code: 'SENDER_REQUIRED',
    };
  }

  const senderAddress = extractSenderAddress(sender);
  if (!senderAddress) {
    return {
      valid: false,
      success: false,
      error: 'Invalid sender address or format',
      code: 'INVALID_SENDER_ADDRESS',
    };
  }

  if (!expectedAddress || typeof expectedAddress !== 'string' || !ethers.isAddress(expectedAddress.trim())) {
    return {
      valid: false,
      success: false,
      error: 'No registered customer wallet on file to verify transaction sender against',
      code: 'EXPECTED_ADDRESS_MISSING',
    };
  }

  const normalizedExpected = expectedAddress.trim().toLowerCase();
  const matches = senderAddress === normalizedExpected;

  if (!matches) {
    logger.warn(
      { sender: senderAddress, expected: normalizedExpected },
      '[EscrowSenderVerification] Transaction sender does not match registered wallet'
    );
    return {
      valid: false,
      success: false,
      sender: senderAddress,
      expected: normalizedExpected,
      error: 'Transaction sender does not match the registered customer wallet for this order',
      code: 'SENDER_MISMATCH',
    };
  }

  return {
    valid: true,
    success: true,
    sender: senderAddress,
    expected: normalizedExpected,
  };
}

/**
 * Validates a sender address for deposit transactions.
 *
 * @param {string|object} sender
 * @param {string} expectedCustomerAddress
 * @returns {{ valid: boolean, success: boolean, sender?: string, error?: string, code?: string }}
 */
export function verifyDepositSender(sender, expectedCustomerAddress) {
  if (!sender) {
    return {
      valid: false,
      success: false,
      error: 'Sender is required for deposit verification',
      code: 'SENDER_REQUIRED',
    };
  }

  return verifyEscrowSender(sender, expectedCustomerAddress);
}

/**
 * Generic sender validation helper.
 *
 * @param {string|object} sender
 * @param {string} expectedAddress
 * @returns {{ valid: boolean, success: boolean, error?: string, code?: string }}
 */
export function verifySender(sender, expectedAddress) {
  if (!sender) {
    return {
      valid: false,
      success: false,
      error: 'Sender is required',
      code: 'SENDER_REQUIRED',
    };
  }

  return verifyEscrowSender(sender, expectedAddress);
}

export default {
  extractSenderAddress,
  verifyEscrowSender,
  verifyDepositSender,
  verifySender,
};
