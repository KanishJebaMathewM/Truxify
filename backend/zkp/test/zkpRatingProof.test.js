import assert from 'assert';
import { describe, it, beforeEach } from 'node:test';
import { zkRatingService, ZkRatingProofService } from '../rating_proof.js';

describe('Zero-Knowledge Driver Rating Proof & Nullifier Anti-Replay Defense', () => {
    const driverAddress = '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5';
    const customerId = 'CUST-88391';
    const tripSecret = 'SECRET_EPHEMERAL_SALT_498103';

    beforeEach(() => {
        zkRatingService.resetState();
    });

    it('should generate deterministic nullifier for specific trip and customer', () => {
        const nullifier1 = zkRatingService.generateNullifier(tripSecret, customerId, 'TRIP-101');
        const nullifier2 = zkRatingService.generateNullifier(tripSecret, customerId, 'TRIP-101');
        const nullifierDiffTrip = zkRatingService.generateNullifier(tripSecret, customerId, 'TRIP-102');

        assert.ok(nullifier1.startsWith('0x'));
        assert.strictEqual(nullifier1, nullifier2);
        assert.notStrictEqual(nullifier1, nullifierDiffTrip);
    });

    it('should generate valid Zero-Knowledge Range Proofs for all valid ratings (1 to 5)', () => {
        for (let rating = 1; rating <= 5; rating++) {
            const tripId = `TRIP-STAR-${rating}`;
            const proofPacket = zkRatingService.generateZkProof(
                driverAddress,
                rating,
                tripSecret,
                customerId,
                tripId
            );

            assert.strictEqual(proofPacket.driverAddress, driverAddress.toLowerCase());
            assert.strictEqual(proofPacket.tripId, tripId);
            assert.ok(proofPacket.commitment.startsWith('0x'));
            assert.strictEqual(proofPacket.proof.announcements.length, 5);
            assert.strictEqual(proofPacket.proof.challenges.length, 5);
            assert.strictEqual(proofPacket.proof.responses.length, 5);

            // Verify ZKP
            const verification = zkRatingService.verifyZkProof(proofPacket);
            assert.strictEqual(verification.valid, true, `Rating ${rating} ZKP should verify`);
        }
    });

    it('should reject out-of-bounds ratings (0, 6, -1, NaN)', () => {
        assert.throws(() => {
            zkRatingService.generateZkProof(driverAddress, 0, tripSecret, customerId, 'TRIP-BAD-0');
        }, /Invalid ratingStars/);

        assert.throws(() => {
            zkRatingService.generateZkProof(driverAddress, 6, tripSecret, customerId, 'TRIP-BAD-6');
        }, /Invalid ratingStars/);

        assert.throws(() => {
            zkRatingService.generateZkProof(driverAddress, -2, tripSecret, customerId, 'TRIP-BAD-NEG');
        }, /Invalid ratingStars/);

        assert.throws(() => {
            zkRatingService.generateZkProof(driverAddress, 'five', tripSecret, customerId, 'TRIP-BAD-STR');
        }, /Invalid ratingStars/);
    });

    it('should reject tampered proofs (tampered masterChallenge, modified response)', () => {
        const proofPacket = zkRatingService.generateZkProof(
            driverAddress,
            5,
            tripSecret,
            customerId,
            'TRIP-TAMPER-TEST'
        );

        // 1. Tamper masterChallenge
        const tamperedPacket1 = JSON.parse(JSON.stringify(proofPacket));
        tamperedPacket1.proof.masterChallenge = '0x1234567890abcdef';
        const verify1 = zkRatingService.verifyZkProof(tamperedPacket1);
        assert.strictEqual(verify1.valid, false);

        // 2. Tamper response on branch 1
        const tamperedPacket2 = JSON.parse(JSON.stringify(proofPacket));
        tamperedPacket2.proof.responses[0] = '0x999999999999999999999999';
        const verify2 = zkRatingService.verifyZkProof(tamperedPacket2);
        assert.strictEqual(verify2.valid, false);

        // 3. Tamper target driver address
        const tamperedPacket3 = JSON.parse(JSON.stringify(proofPacket));
        tamperedPacket3.driverAddress = '0x0000000000000000000000000000000000000001';
        const verify3 = zkRatingService.verifyZkProof(tamperedPacket3);
        assert.strictEqual(verify3.valid, false);
    });

    it('should prevent nullifier replay attacks (double-spending reviews)', () => {
        const proofPacket = zkRatingService.generateZkProof(
            driverAddress,
            5,
            tripSecret,
            customerId,
            'TRIP-DOUBLE-SPEND'
        );

        // First submission succeeds
        const submission1 = zkRatingService.submitVerifiedRating(proofPacket, 5);
        assert.strictEqual(submission1.success, true);
        assert.strictEqual(zkRatingService.isNullifierSpent(proofPacket.nullifierHash), true);

        // Second submission of the EXACT SAME nullifier must be blocked!
        assert.throws(() => {
            zkRatingService.submitVerifiedRating(proofPacket, 5);
        }, /NULLIFIER_ALREADY_SPENT/);

        // Verification also returns invalid for already-spent nullifier
        const verifyAgain = zkRatingService.verifyZkProof(proofPacket);
        assert.strictEqual(verifyAgain.valid, false);
        assert.strictEqual(verifyAgain.reason, 'NULLIFIER_ALREADY_SPENT');
    });

    it('should update driver reputation accumulator with Bayesian smoothing', () => {
        // Driver initial reputation
        const initial = zkRatingService.getDriverReputation(driverAddress);
        assert.strictEqual(initial.ratingCount, 0);

        // Submit Rating 1 (5 stars)
        const p1 = zkRatingService.generateZkProof(driverAddress, 5, 'sec1', 'cust1', 'TRIP-A');
        zkRatingService.submitVerifiedRating(p1, 5);

        // Submit Rating 2 (4 stars)
        const p2 = zkRatingService.generateZkProof(driverAddress, 4, 'sec2', 'cust2', 'TRIP-B');
        zkRatingService.submitVerifiedRating(p2, 4);

        const updated = zkRatingService.getDriverReputation(driverAddress);
        assert.strictEqual(updated.ratingCount, 2);
        assert.ok(updated.bayesianRating >= 4.0 && updated.bayesianRating <= 5.0);
        assert.strictEqual(updated.status, 'ACTIVE');
    });

    it('should maintain proof privacy without exposing raw score in plaintext commitment', () => {
        const p4 = zkRatingService.generateZkProof(driverAddress, 4, 's4', 'c4', 'TRIP-PRIV');
        // Commitment should be a 256-bit hex scalar, not '4' or containing the digit trivially
        assert.ok(p4.commitment.length > 60);
        assert.strictEqual(p4.ratingStars, undefined);
    });
});
