import crypto from 'crypto';

// Large safe prime (256-bit) and generator constants for finite-field ZKP
const MODULUS = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
const ORDER = MODULUS - 1n;

// In-memory registries for nullifiers and driver ratings
const spentNullifiers = new Map(); // nullifierHash -> { tripId, timestamp, driverAddress }
const driverReputationStore = new Map(); // driverAddress -> { count, totalStars, averageRating, ratingsHistory }

/**
 * Computes deterministic SHA-256 BigInt digest
 */
function hashToBigInt(...items) {
    const hash = crypto.createHash('sha256');
    for (const item of items) {
        hash.update(String(item));
    }
    const hex = hash.digest('hex');
    return BigInt('0x' + hex) % ORDER;
}

/**
 * Computes modular exponentiation (base^exp % mod)
 */
function modExp(base, exp, mod) {
    let res = 1n;
    let b = base % mod;
    let e = exp;
    while (e > 0n) {
        if (e % 2n === 1n) res = (res * b) % mod;
        b = (b * b) % mod;
        e = e / 2n;
    }
    return res;
}

/**
 * ZK Rating Proof & Nullifier Anti-Replay Defense Engine
 */
export class ZkRatingProofService {
    constructor() {
        this.G = 2n;
        this.H = hashToBigInt('TRUXIFY_PEDERSEN_GENERATOR_H');
    }

    /**
     * Generates a cryptographically bound nullifier for a specific trip and customer.
     * Prevents duplicate ratings or double-spending rating proofs for the same trip.
     */
    generateNullifier(tripSecret, customerId, tripId = 'TRIP_DEFAULT') {
        if (!tripSecret || !customerId) {
            throw new Error('tripSecret and customerId are required to generate nullifier');
        }
        const hash = crypto.createHash('sha256')
            .update(`NULLIFIER:${tripSecret}:${customerId}:${tripId}`)
            .digest('hex');
        return `0x${hash}`;
    }

    /**
     * Creates a Pedersen Commitment to rating stars: C = g^v * h^r mod p
     *
     * @param {number} ratingStars - Integer from 1 to 5
     * @param {string|BigInt} blindingFactor - Secret entropy scalar
     * @param {string} driverAddress - Ethereum address of target driver
     */
    generateCommitment(ratingStars, blindingFactor, driverAddress) {
        const v = BigInt(ratingStars);
        if (v < 1n || v > 5n) {
            throw new Error('Rating stars must be an integer between 1 and 5');
        }
        const r = typeof blindingFactor === 'bigint' ? blindingFactor : BigInt('0x' + crypto.createHash('sha256').update(String(blindingFactor)).digest('hex')) % ORDER;

        // C = (G^v * H^r) mod MODULUS
        const gTerm = modExp(this.G, v, MODULUS);
        const hTerm = modExp(this.H, r, MODULUS);
        const commitmentBigInt = (gTerm * hTerm) % MODULUS;
        const commitmentHex = '0x' + commitmentBigInt.toString(16).padStart(64, '0');

        return {
            commitmentHex,
            commitmentBigInt,
            blindingFactor: '0x' + r.toString(16).padStart(64, '0'),
            driverAddress: driverAddress.toLowerCase()
        };
    }

    /**
     * Generates a Zero-Knowledge Range Proof (1 <= rating <= 5) using 1-out-of-5 OR-composition.
     * Proves rating is valid without revealing which specific rating (1..5) was submitted.
     */
    generateZkProof(driverAddress, ratingStars, tripSecret, customerId, tripId = 'TRIP-DEFAULT', userBlindingFactor = null) {
        const rating = parseInt(ratingStars, 10);
        if (isNaN(rating) || rating < 1 || rating > 5) {
            throw new Error('Invalid ratingStars: Must be an integer between 1 and 5');
        }

        const normalizedDriver = driverAddress.toLowerCase();
        const nullifierHash = this.generateNullifier(tripSecret, customerId, tripId);

        // Derive or use blinding factor
        const secretSeed = userBlindingFactor || `${tripSecret}_BLIND_${Date.now()}`;
        const commitmentObj = this.generateCommitment(rating, secretSeed, normalizedDriver);
        const r = BigInt(commitmentObj.blindingFactor);
        const C = commitmentObj.commitmentBigInt;

        // 1-of-5 OR-proof generation
        const announcements = [];
        const challenges = new Array(6); // 1-indexed (1..5)
        const responses = new Array(6);
        const randomW = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % ORDER;

        // Real announcement for branch `rating`
        const realAnnounce = modExp(this.H, randomW, MODULUS);

        // Simulate false branches
        for (let i = 1; i <= 5; i++) {
            if (i === rating) {
                announcements[i] = realAnnounce;
            } else {
                // Pick random fake challenge c_i and response z_i
                challenges[i] = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % ORDER;
                responses[i] = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % ORDER;

                // Simulated announcement: a_i = (H^z_i * (C / G^i)^(-c_i)) mod MODULUS
                const gI = modExp(this.G, BigInt(i), MODULUS);
                const denom = modExp(gI, MODULUS - 2n, MODULUS);
                const diff = (C * denom) % MODULUS;
                const hZ = modExp(this.H, responses[i], MODULUS);
                const diffC = modExp(diff, challenges[i], MODULUS);
                const diffCInv = modExp(diffC, MODULUS - 2n, MODULUS);
                announcements[i] = (hZ * diffCInv) % MODULUS;
            }
        }

        // Master Fiat-Shamir Challenge
        const announceConcat = announcements.slice(1).map(a => a.toString(16)).join(':');
        const masterChallenge = hashToBigInt(
            normalizedDriver,
            commitmentObj.commitmentHex,
            nullifierHash,
            tripId,
            announceConcat
        );

        // Solve for the real challenge: c_rating = (masterChallenge - sum(c_other)) mod ORDER
        let sumOtherChallenges = 0n;
        for (let i = 1; i <= 5; i++) {
            if (i !== rating) {
                sumOtherChallenges = (sumOtherChallenges + challenges[i]) % ORDER;
            }
        }
        let realChallenge = (masterChallenge - sumOtherChallenges) % ORDER;
        if (realChallenge < 0n) realChallenge += ORDER;
        challenges[rating] = realChallenge;

        // Real response: z_rating = (randomW + realChallenge * r) mod ORDER
        responses[rating] = (randomW + (realChallenge * r)) % ORDER;

        return {
            driverAddress: normalizedDriver,
            tripId,
            nullifierHash,
            commitment: commitmentObj.commitmentHex,
            proof: {
                announcements: announcements.slice(1).map(a => '0x' + a.toString(16)),
                challenges: challenges.slice(1).map(c => '0x' + c.toString(16)),
                responses: responses.slice(1).map(z => '0x' + z.toString(16)),
                masterChallenge: '0x' + masterChallenge.toString(16)
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Verifies the cryptographic Zero-Knowledge Range Proof and ensures nullifier freshness.
     */
    verifyZkProof(proofPacket) {
        if (!proofPacket || !proofPacket.driverAddress || !proofPacket.commitment || !proofPacket.nullifierHash || !proofPacket.proof) {
            return { valid: false, reason: 'MALFORMED_PROOF_PACKET' };
        }

        const { driverAddress, tripId, nullifierHash, commitment, proof } = proofPacket;
        const normalizedDriver = driverAddress.toLowerCase();

        // 1. Replay Attack / Double-spending Check
        if (spentNullifiers.has(nullifierHash)) {
            return {
                valid: false,
                reason: 'NULLIFIER_ALREADY_SPENT',
                details: `Nullifier ${nullifierHash} was already used on trip ${spentNullifiers.get(nullifierHash).tripId}`
            };
        }

        const announcements = proof.announcements.map(a => BigInt(a));
        const challenges = proof.challenges.map(c => BigInt(c));
        const responses = proof.responses.map(r => BigInt(r));
        const masterChallenge = BigInt(proof.masterChallenge);
        const C = BigInt(commitment);

        if (announcements.length !== 5 || challenges.length !== 5 || responses.length !== 5) {
            return { valid: false, reason: 'INVALID_PROOF_DIMENSIONS' };
        }

        // 2. Verify Challenge Sum: sum(c_i) == masterChallenge mod ORDER
        let sumChallenges = 0n;
        for (const c of challenges) {
            sumChallenges = (sumChallenges + c) % ORDER;
        }

        if (sumChallenges !== masterChallenge) {
            return { valid: false, reason: 'FIAT_SHAMIR_CHALLENGE_MISMATCH' };
        }

        // 3. Verify Fiat-Shamir Reconstruction
        const announceConcat = announcements.map(a => a.toString(16)).join(':');
        const expectedMasterChallenge = hashToBigInt(
            normalizedDriver,
            commitment,
            nullifierHash,
            tripId,
            announceConcat
        );

        if (masterChallenge !== expectedMasterChallenge) {
            return { valid: false, reason: 'MASTER_CHALLENGE_TAMPERED' };
        }

        // 4. Verify each branch equation: H^z_i == a_i * (C / G^i)^c_i mod MODULUS
        for (let idx = 0; idx < 5; idx++) {
            const i = BigInt(idx + 1);
            const a_i = announcements[idx];
            const c_i = challenges[idx];
            const z_i = responses[idx];

            const leftSide = modExp(this.H, z_i, MODULUS);

            const gI = modExp(this.G, i, MODULUS);
            const gIInv = modExp(gI, MODULUS - 2n, MODULUS);
            const diff = (C * gIInv) % MODULUS;
            const diffC = modExp(diff, c_i, MODULUS);
            const rightSide = (a_i * diffC) % MODULUS;

            if (leftSide !== rightSide) {
                return { valid: false, reason: `BRANCH_${i}_VERIFICATION_FAILED` };
            }
        }

        return {
            valid: true,
            driverAddress: normalizedDriver,
            nullifierHash,
            tripId
        };
    }

    /**
     * Submits verified anonymous rating proof, consumes nullifier, and updates reputation accumulator.
     */
    submitVerifiedRating(proofPacket, actualRatingForLedger = null) {
        const verification = this.verifyZkProof(proofPacket);
        if (!verification.valid) {
            throw new Error(`ZKP_VERIFICATION_REJECTED: ${verification.reason}`);
        }

        const { driverAddress, nullifierHash, tripId } = proofPacket;
        const normalizedDriver = driverAddress.toLowerCase();

        // Register nullifier in spent registry (Defense against Replay)
        spentNullifiers.set(nullifierHash, {
            tripId,
            driverAddress: normalizedDriver,
            consumedAt: new Date().toISOString()
        });

        // Update Driver Anonymous Reputation Ledger
        if (!driverReputationStore.has(normalizedDriver)) {
            driverReputationStore.set(normalizedDriver, {
                driverAddress: normalizedDriver,
                ratingCount: 0,
                totalStarsSum: 0,
                bayesianRating: 5.0,
                lastUpdated: new Date().toISOString()
            });
        }

        const rep = driverReputationStore.get(normalizedDriver);
        rep.ratingCount += 1;

        // If actual rating integer is supplied privately by client or verified off-chain
        if (actualRatingForLedger && actualRatingForLedger >= 1 && actualRatingForLedger <= 5) {
            rep.totalStarsSum += actualRatingForLedger;
        } else {
            // Default increment median assumption if fully zero-knowledge
            rep.totalStarsSum += 5;
        }

        // Bayesian smoothed rating: (C*m + sum) / (C + n) where C = 5 prior weight, m = 4.5 prior mean
        const priorWeight = 5;
        const priorMean = 4.5;
        rep.bayesianRating = parseFloat(((priorWeight * priorMean + rep.totalStarsSum) / (priorWeight + rep.ratingCount)).toFixed(2));
        rep.lastUpdated = new Date().toISOString();

        return {
            success: true,
            driverAddress: normalizedDriver,
            nullifierHash,
            tripId,
            reputation: {
                ratingCount: rep.ratingCount,
                bayesianRating: rep.bayesianRating
            }
        };
    }

    /**
     * Retrieves aggregated reputation stats for a driver
     */
    getDriverReputation(driverAddress) {
        const normalizedDriver = (driverAddress || '').toLowerCase();
        if (!driverReputationStore.has(normalizedDriver)) {
            return {
                driverAddress: normalizedDriver,
                ratingCount: 0,
                bayesianRating: 5.0,
                status: 'UNRATED'
            };
        }
        return {
            ...driverReputationStore.get(normalizedDriver),
            status: 'ACTIVE'
        };
    }

    /**
     * Checks if a nullifier has already been spent
     */
    isNullifierSpent(nullifierHash) {
        return spentNullifiers.has(nullifierHash);
    }

    /**
     * Resets in-memory registries (for test isolation)
     */
    resetState() {
        spentNullifiers.clear();
        driverReputationStore.clear();
    }
}

export const zkRatingService = new ZkRatingProofService();
export default zkRatingService;
