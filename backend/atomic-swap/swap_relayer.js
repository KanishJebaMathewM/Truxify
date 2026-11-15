
import { ethers } from "ethers";
import crypto from "node:crypto";

/**
 * Cross-Chain HTLC Atomic Swap Relayer
 *
 * Provides:
 * - Secure 32-byte secret generation
 * - SHA-256 and Keccak-256 hashlocks
 * - Constant-time preimage comparison
 * - Timelock validation
 * - Cross-chain expiry validation
 * - EVM address validation
 * - Safe integer amount handling
 * - Canonical swap ID generation
 * - Lifecycle state transition validation
 */

export class AtomicSwapRelayer {
    constructor() {
        this.MIN_LOCK_DURATION = 3600;
        this.MAX_LOCK_DURATION = 2592000;
        this.MIN_CROSS_CHAIN_DELTA = 3600;

        this.MAX_SWAP_AMOUNT = 1000000n;

        this.SUPPORTED_ALGORITHMS = [
            "keccak256",
            "sha256",
        ];
    }

    // ==========================================
    // HASHLOCK GENERATION
    // ==========================================

    generateHashLockSecret(algorithm = "keccak256") {
        const algo = this._normalizeAlgorithm(algorithm);

        const secretBytes = crypto.randomBytes(32);
        const secretHex = ethers.hexlify(secretBytes);

        const hashLock = this.hashPreimage(
            secretBytes,
            algo
        );

        return {
            secretHex,
            secretBytes,
            hashLock,
            algorithm: algo,
        };
    }

    // ==========================================
    // INPUT VALIDATION
    // ==========================================

    _normalizeAlgorithm(algorithm) {
        if (typeof algorithm !== "string") {
            throw new TypeError("Invalid hash algorithm");
        }

        const algo = algorithm.toLowerCase();

        if (!this.SUPPORTED_ALGORITHMS.includes(algo)) {
            throw new Error(
                `Unsupported hash algorithm: ${algorithm}`
            );
        }

        return algo;
    }

    _getSecretBytes(secret) {
        if (typeof secret === "string") {
            if (secret.length === 0) {
                throw new Error("Secret cannot be empty");
            }

            if (secret.startsWith("0x")) {
                if (!ethers.isHexString(secret)) {
                    throw new Error("Invalid hexadecimal secret");
                }

                return ethers.getBytes(secret);
            }

            // Preserve support for unprefixed hexadecimal secrets.
            if (
                /^[0-9a-fA-F]+$/.test(secret) &&
                secret.length >= 32 &&
                secret.length % 2 === 0
            ) {
                return ethers.getBytes(`0x${secret}`);
            }

            return ethers.toUtf8Bytes(secret);
        }

        if (
            secret instanceof Uint8Array ||
            Buffer.isBuffer(secret)
        ) {
            return Buffer.from(secret);
        }

        throw new TypeError(
            "Secret must be a string, Buffer, or Uint8Array"
        );
    }

    // ==========================================
    // PREIMAGE HASHING
    // ==========================================

    hashPreimage(secret, algorithm = "keccak256") {
        const algo = this._normalizeAlgorithm(algorithm);
        const bytes = this._getSecretBytes(secret);

        if (bytes.length < 16) {
            throw new Error(
                "Preimage must contain at least 16 bytes"
            );
        }

        if (algo === "keccak256") {
            return ethers.keccak256(bytes);
        }

        return ethers.sha256(bytes);
    }

    // ==========================================
    // PREIMAGE VERIFICATION
    // ==========================================

    verifyPreimage(
        secret,
        expectedHashLock,
        algorithm = "keccak256"
    ) {
        try {
            if (
                typeof expectedHashLock !== "string" ||
                !ethers.isHexString(expectedHashLock, 32)
            ) {
                return false;
            }

            const computedHash = this.hashPreimage(
                secret,
                algorithm
            );

            const computedBuffer = Buffer.from(
                computedHash.slice(2),
                "hex"
            );

            const expectedBuffer = Buffer.from(
                expectedHashLock.slice(2),
                "hex"
            );

            return crypto.timingSafeEqual(
                computedBuffer,
                expectedBuffer
            );
        } catch {
            return false;
        }
    }

    // ==========================================
    // TIMELOCK VALIDATION
    // ==========================================

    validateTimelock(
        lockDurationInSeconds,
        minDuration = this.MIN_LOCK_DURATION,
        maxDuration = this.MAX_LOCK_DURATION
    ) {
        const duration = Number(lockDurationInSeconds);

        if (
            !Number.isSafeInteger(duration) ||
            duration <= 0
        ) {
            return {
                valid: false,
                duration: 0,
                error: "Lock duration must be a positive safe integer",
            };
        }

        if (
            !Number.isSafeInteger(minDuration) ||
            !Number.isSafeInteger(maxDuration) ||
            minDuration <= 0 ||
            maxDuration < minDuration
        ) {
            return {
                valid: false,
                duration,
                error: "Invalid timelock configuration",
            };
        }

        if (duration < minDuration) {
            return {
                valid: false,
                duration,
                error: `Lock duration is below the minimum of ${minDuration} seconds`,
            };
        }

        if (duration > maxDuration) {
            return {
                valid: false,
                duration,
                error: `Lock duration exceeds the maximum of ${maxDuration} seconds`,
            };
        }

        return {
            valid: true,
            duration,
        };
    }

    // ==========================================
    // CROSS-CHAIN TIMELOCK VALIDATION
    // ==========================================

    validateCrossChainTimelocks(
        initiatorTimestamp,
        counterpartyTimestamp,
        minDelta = this.MIN_CROSS_CHAIN_DELTA
    ) {
        const init = Number(initiatorTimestamp);
        const counter = Number(counterpartyTimestamp);

        if (
            !Number.isSafeInteger(init) ||
            !Number.isSafeInteger(counter) ||
            !Number.isSafeInteger(minDelta) ||
            init <= 0 ||
            counter <= 0 ||
            minDelta <= 0
        ) {
            return {
                safe: false,
                delta: 0,
                error: "Timelocks must be positive safe-integer timestamps",
            };
        }

        const delta = init - counter;

        if (delta < minDelta) {
            return {
                safe: false,
                delta,
                error: `Unsafe cross-chain timelock delta: minimum required is ${minDelta} seconds`,
            };
        }

        return {
            safe: true,
            delta,
        };
    }

    // ==========================================
    // ADDRESS VALIDATION
    // ==========================================

    validateParticipantAddress(
        address,
        label = "Address"
    ) {
        if (
            typeof address !== "string" ||
            !ethers.isAddress(address)
        ) {
            throw new Error(`${label} is not a valid EVM address`);
        }

        const checksummed = ethers.getAddress(address);

        if (checksummed === ethers.ZeroAddress) {
            throw new Error(
                `${label} cannot be the zero address`
            );
        }

        return checksummed;
    }

    // ==========================================
    // AMOUNT VALIDATION
    // ==========================================

    validateAmount(amount) {
        let parsed;

        try {
            if (
                typeof amount === "number" &&
                !Number.isSafeInteger(amount)
            ) {
                throw new Error("Unsafe numeric amount");
            }

            if (
                typeof amount !== "bigint" &&
                typeof amount !== "string" &&
                typeof amount !== "number"
            ) {
                throw new Error("Invalid amount type");
            }

            const value = String(amount);

            if (!/^[0-9]+$/.test(value)) {
                throw new Error("Amount must be a positive integer");
            }

            parsed = BigInt(value);
        } catch {
            return {
                valid: false,
                parsed: 0n,
                error: "Invalid swap amount",
            };
        }

        if (parsed <= 0n) {
            return {
                valid: false,
                parsed: 0n,
                error: "Swap amount must be greater than zero",
            };
        }

        if (parsed > this.MAX_SWAP_AMOUNT) {
            return {
                valid: false,
                parsed,
                error: `Swap amount exceeds maximum limit of ${this.MAX_SWAP_AMOUNT}`,
            };
        }

        return {
            valid: true,
            parsed,
        };
    }

    // ==========================================
    // STATE TRANSITION VALIDATION
    // ==========================================

    validateStateTransition(
        currentStatus,
        action,
        {
            now = Math.floor(Date.now() / 1000),
            lockTimestamp,
        } = {}
    ) {
        const status =
            typeof currentStatus === "string"
                ? currentStatus.toLowerCase()
                : "";

        const act =
            typeof action === "string"
                ? action.toLowerCase()
                : "";

        if (
            !Number.isSafeInteger(now) ||
            !Number.isSafeInteger(lockTimestamp) ||
            now <= 0 ||
            lockTimestamp <= 0
        ) {
            return {
                allowed: false,
                reason: "Invalid current time or lock timestamp",
            };
        }

        if (status !== "pending") {
            return {
                allowed: false,
                reason: `Cannot ${act} a swap with status "${status}"`,
            };
        }

        // Claim is allowed strictly before expiry.
        if (act === "claim") {
            if (now >= lockTimestamp) {
                return {
                    allowed: false,
                    reason: "Swap has expired. Claim is no longer allowed.",
                };
            }

            return { allowed: true };
        }

        // Refund is allowed at or after expiry.
        if (act === "refund") {
            if (now < lockTimestamp) {
                return {
                    allowed: false,
                    reason: "Swap timelock has not expired",
                };
            }

            return { allowed: true };
        }

        return {
            allowed: false,
            reason: `Unknown swap action: "${action}"`,
        };
    }

    // ==========================================
    // CANONICAL SWAP ID
    // ==========================================

    computeCanonicalSwapId(
        sender,
        recipient,
        tokenAddress,
        amount,
        hashLock,
        lockDuration,
        chainId = 137
    ) {
        const validSender =
            this.validateParticipantAddress(sender, "Sender");

        const validRecipient =
            this.validateParticipantAddress(recipient, "Recipient");

        if (validSender === validRecipient) {
            throw new Error(
                "Sender and recipient must be different addresses"
            );
        }

        const token =
            tokenAddress === null ||
            tokenAddress === undefined ||
            tokenAddress === ""
                ? ethers.ZeroAddress
                : this.validateParticipantAddress(
                    tokenAddress,
                    "Token address"
                );

        const validatedAmount = this.validateAmount(amount);

        if (!validatedAmount.valid) {
            throw new Error(validatedAmount.error);
        }

        if (!ethers.isHexString(hashLock, 32)) {
            throw new Error(
                "Hashlock must be a valid bytes32 value"
            );
        }

        if (
            !Number.isSafeInteger(lockDuration) ||
            lockDuration <= 0
        ) {
            throw new Error(
                "Lock duration must be a positive safe integer"
            );
        }

        if (
            !Number.isSafeInteger(chainId) ||
            chainId <= 0
        ) {
            throw new Error("Invalid chain ID");
        }

        const encoded = ethers.AbiCoder
            .defaultAbiCoder()
            .encode(
                [
                    "address",
                    "address",
                    "address",
                    "uint256",
                    "bytes32",
                    "uint256",
                    "uint256",
                ],
                [
                    validSender,
                    validRecipient,
                    token,
                    validatedAmount.parsed,
                    hashLock,
                    lockDuration,
                    chainId,
                ]
            );

        return ethers.keccak256(encoded);
    }
}

export const atomicSwapRelayer =
    new AtomicSwapRelayer();
