import { ethers } from 'ethers';
import crypto from 'crypto';

/**
 * Cross-Chain HTLC Atomic Swap Preimage & Timelock Validation Relayer
 *
 * Implements rigorous cryptographic preimage validation, SHA-256 / Keccak-256
 * algorithm support, timelock boundaries to mitigate race conditions, and
 * formal state transition guards for cross-chain and intra-chain swaps.
 */
export class AtomicSwapRelayer {
  constructor() {
    this.MIN_LOCK_DURATION = 3600; // 1 hour minimum to prevent front-running / griefing
    this.MAX_LOCK_DURATION = 2592000; // 30 days maximum
    this.MIN_CROSS_CHAIN_DELTA = 3600; // 1 hour safety margin between chain locks
    this.MAX_SWAP_AMOUNT = 1000000; // Max 1,000,000 units per transaction
  }

  /**
   * Generates a cryptographically secure 32-byte secret and corresponding hashlock
   * @param {'keccak256'|'sha256'} algorithm 
   * @returns {{ secretHex: string, secretBytes: Uint8Array, hashLock: string, algorithm: string }}
   */
  generateHashLockSecret(algorithm = 'keccak256') {
    const secretBytes = ethers.randomBytes(32);
    const secretHex = ethers.hexlify(secretBytes);
    const hashLock = this.hashPreimage(secretBytes, algorithm);
    return {
      secretHex,
      secretBytes,
      hashLock,
      algorithm: algorithm.toLowerCase()
    };
  }

  /**
   * Hashes a secret preimage using the designated hashing algorithm.
   * Accepts 0x-prefixed hex, unprefixed hex, Uint8Array/Buffer, or UTF-8 strings.
   * @param {string|Uint8Array|Buffer} secret 
   * @param {'keccak256'|'sha256'} algorithm 
   * @returns {string} 0x-prefixed hex hash
   */
  hashPreimage(secret, algorithm = 'keccak256') {
    if (!secret) {
      throw new Error('Preimage secret cannot be null or empty');
    }

    let bytes;
    if (typeof secret === 'string') {
      if (/^0x[0-9a-fA-F]+$/i.test(secret)) {
        bytes = ethers.getBytes(secret);
      } else if (/^[0-9a-fA-F]{32,}$/i.test(secret) && secret.length % 2 === 0) {
        bytes = ethers.getBytes('0x' + secret);
      } else {
        bytes = ethers.toUtf8Bytes(secret);
      }
    } else if (secret instanceof Uint8Array || Buffer.isBuffer(secret)) {
      bytes = secret;
    } else {
      throw new Error('Unsupported secret format: expected string, Buffer, or Uint8Array');
    }

    if (bytes.length < 16) {
      throw new Error(`Preimage entropy too low: minimum 16 bytes required, received ${bytes.length} bytes`);
    }

    const algo = (algorithm || 'keccak256').toLowerCase();
    if (algo === 'keccak256') {
      return ethers.keccak256(bytes);
    } else if (algo === 'sha256') {
      return ethers.sha256(bytes);
    } else {
      throw new Error(`Unsupported hashlock algorithm: "${algorithm}". Expected "keccak256" or "sha256"`);
    }
  }

  /**
   * Verifies whether a given preimage matches an expected hashlock in constant-time
   * @param {string|Uint8Array|Buffer} secret 
   * @param {string} expectedHashLock 
   * @param {'keccak256'|'sha256'} algorithm 
   * @returns {boolean}
   */
  verifyPreimage(secret, expectedHashLock, algorithm = 'keccak256') {
    if (!secret || !expectedHashLock) {
      return false;
    }

    try {
      const computedHash = this.hashPreimage(secret, algorithm);
      const computedBuf = Buffer.from(computedHash.replace(/^0x/i, '').toLowerCase(), 'hex');
      const expectedBuf = Buffer.from(expectedHashLock.replace(/^0x/i, '').toLowerCase(), 'hex');

      if (computedBuf.length !== expectedBuf.length || computedBuf.length === 0) {
        return false;
      }

      return crypto.timingSafeEqual(computedBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Validates timelock duration boundaries
   * @param {number|string} lockDurationInSeconds 
   * @param {number} minDuration 
   * @param {number} maxDuration 
   * @returns {{ valid: boolean, duration: number, error?: string }}
   */
  validateTimelock(lockDurationInSeconds, minDuration = this.MIN_LOCK_DURATION, maxDuration = this.MAX_LOCK_DURATION) {
    const duration = Number(lockDurationInSeconds);

    if (!Number.isInteger(duration) || duration <= 0) {
      return { valid: false, duration: 0, error: 'Lock duration must be a positive integer in seconds' };
    }

    if (duration < minDuration) {
      return {
        valid: false,
        duration,
        error: `Lock duration (${duration}s) below minimum safety threshold (${minDuration}s)`
      };
    }

    if (duration > maxDuration) {
      return {
        valid: false,
        duration,
        error: `Lock duration (${duration}s) exceeds maximum allowed horizon (${maxDuration}s)`
      };
    }

    return { valid: true, duration };
  }

  /**
   * Validates cross-chain timelock safety delta.
   * In cross-chain HTLC, the initiator (chain A) lock time MUST be strictly greater
   * than the participant (chain B) lock time by at least minDelta to allow safe claim propagation.
   * @param {number} initiatorDuration 
   * @param {number} counterpartyDuration 
   * @param {number} minDelta 
   * @returns {{ safe: boolean, delta: number, error?: string }}
   */
  validateCrossChainTimelocks(initiatorDuration, counterpartyDuration, minDelta = this.MIN_CROSS_CHAIN_DELTA) {
    const init = Number(initiatorDuration);
    const counter = Number(counterpartyDuration);

    if (isNaN(init) || isNaN(counter)) {
      return { safe: false, delta: 0, error: 'Timelocks must be valid numeric timestamps or durations' };
    }

    const delta = init - counter;
    if (delta < minDelta) {
      return {
        safe: false,
        delta,
        error: `Cross-chain timelock delta (${delta}s) is unsafe: initiator lock duration must exceed counterparty by at least ${minDelta}s`
      };
    }

    return { safe: true, delta };
  }

  /**
   * Validates Ethereum/EVM participant address format and rejects ZeroAddress
   * @param {string} address 
   * @param {string} label 
   * @returns {string} Checksummed address
   */
  validateParticipantAddress(address, label = 'Address') {
    if (!address || typeof address !== 'string') {
      throw new Error(`${label} must be a non-empty string`);
    }

    if (!ethers.isAddress(address)) {
      throw new Error(`${label} "${address}" is not a valid EVM address format`);
    }

    const checksummed = ethers.getAddress(address);
    if (checksummed === ethers.ZeroAddress) {
      throw new Error(`${label} cannot be the Zero Address (${ethers.ZeroAddress})`);
    }

    return checksummed;
  }

  /**
   * Validates swap amount format and bounds
   * @param {number|string|bigint} amount 
   * @returns {{ valid: boolean, parsed: number, error?: string }}
   */
  validateAmount(amount) {
    const num = Number(amount);
    if (isNaN(num) || num <= 0) {
      return { valid: false, parsed: 0, error: 'Swap amount must be a positive number greater than 0' };
    }

    if (num > this.MAX_SWAP_AMOUNT) {
      return { valid: false, parsed: num, error: `Swap amount (${num}) exceeds maximum safety limit (${this.MAX_SWAP_AMOUNT})` };
    }

    return { valid: true, parsed: num };
  }

  /**
   * Validates swap lifecycle state transition
   * @param {'pending'|'claimed'|'refunded'} currentStatus 
   * @param {'claim'|'refund'} action 
   * @param {{ now?: number, lockTimestamp: number }} context 
   * @returns {{ allowed: boolean, reason?: string }}
   */
  validateStateTransition(currentStatus, action, { now = Math.floor(Date.now() / 1000), lockTimestamp }) {
    const status = (currentStatus || '').toLowerCase();
    const act = (action || '').toLowerCase();

    if (status !== 'pending') {
      return {
        allowed: false,
        reason: `Cannot ${act} swap with current status "${status}". Only "pending" swaps can transition.`
      };
    }

    if (act === 'claim') {
      if (now > lockTimestamp) {
        return {
          allowed: false,
          reason: `Swap timelock has expired (expired at ${lockTimestamp}, current time ${now}). Claim rejected; swap is eligible for refund.`
        };
      }
      return { allowed: true };
    }

    if (act === 'refund') {
      if (now < lockTimestamp) {
        return {
          allowed: false,
          reason: `Swap timelock has not expired yet (expires at ${lockTimestamp}, current time ${now}). Refund locked.`
        };
      }
      return { allowed: true };
    }

    return { allowed: false, reason: `Unknown swap action: "${action}"` };
  }

  /**
   * Computes deterministic canonical swap identifier
   * @param {string} sender 
   * @param {string} recipient 
   * @param {string} tokenAddress 
   * @param {string|number} amount 
   * @param {string} hashLock 
   * @param {number} lockDuration 
   * @param {number} chainId 
   * @returns {string} 0x-prefixed 32-byte hex hash
   */
  computeCanonicalSwapId(sender, recipient, tokenAddress, amount, hashLock, lockDuration, chainId = 137) {
    const validSender = this.validateParticipantAddress(sender, 'Sender');
    const validRecipient = this.validateParticipantAddress(recipient, 'Recipient');
    const token = tokenAddress && ethers.isAddress(tokenAddress) ? ethers.getAddress(tokenAddress) : ethers.ZeroAddress;
    
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'string', 'bytes32', 'uint256', 'uint256'],
      [validSender, validRecipient, token, amount.toString(), hashLock, lockDuration, chainId]
    );

    return ethers.keccak256(encoded);
  }
}

export const atomicSwapRelayer = new AtomicSwapRelayer();
