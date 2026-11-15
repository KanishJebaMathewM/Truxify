
import { ethers } from 'ethers';
import crypto from 'crypto';

export class AtomicSwapRelayer {

  constructor(options = {}) {
    this.MIN_LOCK_DURATION = options.minLockDuration ?? 3600;
    this.MAX_LOCK_DURATION = options.maxLockDuration ?? 2592000;
    this.MIN_CROSS_CHAIN_DELTA = options.minCrossChainDelta ?? 3600;
    this.MAX_SWAP_AMOUNT = BigInt(options.maxSwapAmount ?? 1000000);
    this.SWAP_VERSION = 'AtomicSwapRelayer:v1';
  }

  // Generate cryptographically secure secret and hashlock

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

  // Convert secret into bytes

  normalizePreimage(secret) {

    if (typeof secret === 'string') {

      if (/^0x(?:[0-9a-fA-F]{2})+$/i.test(secret)) {
        return ethers.getBytes(secret);
      }

      if (/^[0-9a-fA-F]{32,}$/.test(secret) &&
          secret.length % 2 === 0) {
        return ethers.getBytes('0x' + secret);
      }

      return ethers.toUtf8Bytes(secret);
    }

    if (secret instanceof Uint8Array || Buffer.isBuffer(secret)) {
      return Uint8Array.from(secret);
    }

    throw new Error('Invalid preimage format');
  }

  // Hash preimage

  hashPreimage(secret, algorithm = 'keccak256') {

    if (secret === null || secret === undefined || secret === '') {
      throw new Error('Preimage cannot be empty');
    }

    const bytes = this.normalizePreimage(secret);

    if (bytes.length < 16) {
      throw new Error('Preimage must contain at least 16 bytes');
    }

    const algo = algorithm.toLowerCase();

    switch (algo) {

      case 'keccak256':
        return ethers.keccak256(bytes);

      case 'sha256':
        return ethers.sha256(bytes);

      default:
        throw new Error('Unsupported hashing algorithm');
    }
  }

  // Strict hashlock validation

  validateHashLock(hashLock) {

    if (!ethers.isHexString(hashLock, 32)) {
      throw new Error('Hashlock must be exactly 32 bytes');
    }

    return hashLock.toLowerCase();
  }

  // Verify preimage using constant-time comparison

  verifyPreimage(secret, expectedHashLock, algorithm = 'keccak256') {

    try {

      const expected = this.validateHashLock(expectedHashLock);

      const computed = this.hashPreimage(secret, algorithm);

      const computedBuffer = Buffer.from(computed.slice(2), 'hex');
      const expectedBuffer = Buffer.from(expected.slice(2), 'hex');

      return crypto.timingSafeEqual(
        computedBuffer,
        expectedBuffer
      );

    } catch {
      return false;
    }
  }

  // Validate timelock duration

  validateTimelock(
    lockDuration,
    minDuration = this.MIN_LOCK_DURATION,
    maxDuration = this.MAX_LOCK_DURATION
  ) {

    const duration = Number(lockDuration);

    if (!Number.isSafeInteger(duration) || duration <= 0) {
      return {
        valid: false,
        duration: 0,
        error: 'Invalid lock duration'
      };
    }

    if (duration < minDuration) {
      return {
        valid: false,
        duration,
        error: 'Lock duration is below minimum threshold'
      };
    }

    if (duration > maxDuration) {
      return {
        valid: false,
        duration,
        error: 'Lock duration exceeds maximum threshold'
      };
    }

    return {
      valid: true,
      duration
    };
  }

  // Validate cross-chain timelock difference

  validateCrossChainTimelocks(
    initiatorDuration,
    counterpartyDuration,
    minDelta = this.MIN_CROSS_CHAIN_DELTA
  ) {

    const init = Number(initiatorDuration);
    const counter = Number(counterpartyDuration);

    if (
      !Number.isSafeInteger(init) ||
      !Number.isSafeInteger(counter) ||
      !Number.isSafeInteger(minDelta) ||
      minDelta <= 0
    ) {
      return {
        safe: false,
        delta: 0,
        error: 'Invalid timelock values'
      };
    }

    const delta = init - counter;

    if (delta < minDelta) {
      return {
        safe: false,
        delta,
        error: 'Insufficient cross-chain safety margin'
      };
    }

    return {
      safe: true,
      delta
    };
  }

  // Validate participant addresses

  validateParticipantAddress(address, label = 'Address') {

    if (!address || typeof address !== 'string') {
      throw new Error(`${label} is required`);
    }

    if (!ethers.isAddress(address)) {
      throw new Error(`${label} is invalid`);
    }

    const checksummed = ethers.getAddress(address);

    if (checksummed === ethers.ZeroAddress) {
      throw new Error(`${label} cannot be zero address`);
    }

    return checksummed;
  }

  // Validate swap amount using BigInt

  validateAmount(amount) {

    try {

      if (
        typeof amount === 'number' &&
        !Number.isSafeInteger(amount)
      ) {
        throw new Error('Unsafe numeric precision');
      }

      if (
        typeof amount === 'string' &&
        !/^[0-9]+$/.test(amount)
      ) {
        throw new Error('Amount must be an integer');
      }

      const parsed = BigInt(amount);

      if (parsed <= 0n) {
        throw new Error('Amount must be greater than zero');
      }

      if (parsed > this.MAX_SWAP_AMOUNT) {
        throw new Error('Amount exceeds maximum limit');
      }

      return {
        valid: true,
        parsed: parsed.toString()
      };

    } catch (error) {

      return {
        valid: false,
        parsed: '0',
        error: error.message
      };
    }
  }

  // Validate swap state transition

  validateStateTransition(
    currentStatus,
    action,
    {
      now = Math.floor(Date.now() / 1000),
      lockTimestamp
    }
  ) {

    const status = (currentStatus || '').toLowerCase();
    const act = (action || '').toLowerCase();

    if (status !== 'pending') {
      return {
        allowed: false,
        reason: 'Only pending swaps can transition'
      };
    }

    if (
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(lockTimestamp) ||
      lockTimestamp <= 0
    ) {
      return {
        allowed: false,
        reason: 'Invalid timestamp'
      };
    }

    // Claim is permitted strictly before expiry

    if (act === 'claim') {

      if (now >= lockTimestamp) {
        return {
          allowed: false,
          reason: 'Timelock expired. Claim rejected.'
        };
      }

      return { allowed: true };
    }

    // Refund is permitted at or after expiry

    if (act === 'refund') {

      if (now < lockTimestamp) {
        return {
          allowed: false,
          reason: 'Timelock has not expired'
        };
      }

      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'Unknown swap action'
    };
  }

  // Generate canonical swap ID

  computeCanonicalSwapId(
    sender,
    recipient,
    tokenAddress,
    amount,
    hashLock,
    lockTimestamp,
    chainId = 137
  ) {

    const validSender =
      this.validateParticipantAddress(sender, 'Sender');

    const validRecipient =
      this.validateParticipantAddress(recipient, 'Recipient');

    const token = tokenAddress === null ||
                  tokenAddress === undefined
      ? ethers.ZeroAddress
      : this.validateParticipantAddress(tokenAddress, 'Token');

    const validHashLock = this.validateHashLock(hashLock);

    const amountResult = this.validateAmount(amount);

    if (!amountResult.valid) {
      throw new Error(amountResult.error);
    }

    if (
      !Number.isSafeInteger(lockTimestamp) ||
      lockTimestamp <= 0
    ) {
      throw new Error('Invalid lock timestamp');
    }

    if (
      !Number.isSafeInteger(chainId) ||
      chainId <= 0
    ) {
      throw new Error('Invalid chain ID');
    }

    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'string',
        'uint256',
        'address',
        'address',
        'address',
        'uint256',
        'bytes32',
        'uint256',
        'uint256'
      ],
      [
        this.SWAP_VERSION,
        chainId,
        validSender,
        validRecipient,
        token,
        BigInt(amountResult.parsed),
        validHashLock,
        lockTimestamp,
        chainId
      ]
    );

    return ethers.keccak256(encoded);
  }
}

export const atomicSwapRelayer = new AtomicSwapRelayer();
