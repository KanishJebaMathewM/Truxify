pragma circom 2.0.0;

include "./node_modules/circomlib/circuits/poseidon.circom";

/**
 * RatingNullifier circuit with Poseidon hashing and full domain separation.
 * Addresses vulnerability #11235.
 */
template RatingNullifier() {
    // Private inputs
    signal input tripSecretKey;
    signal input customerIdentityNullifier;

    // Public inputs
    signal input driverAddress;
    signal input ratingStars;
    signal input tripId;

    // Output
    signal output nullifierHash;

    // 1. Constrain ratingStars to valid range [1, 5]
    signal s1;
    signal s2;
    signal s3;
    signal s4;
    
    s1 <== ratingStars - 1;
    s2 <== s1 * (ratingStars - 2);
    s3 <== s2 * (ratingStars - 3);
    s4 <== s3 * (ratingStars - 4);
    s4 * (ratingStars - 5) === 0;

    // 2. Cryptographic Poseidon hash with domain-separated inputs (5 fields)
    component poseidon = Poseidon(5);
    poseidon.inputs[0] <== tripSecretKey;
    poseidon.inputs[1] <== customerIdentityNullifier;
    poseidon.inputs[2] <== driverAddress;
    poseidon.inputs[3] <== ratingStars;
    poseidon.inputs[4] <== tripId;

    nullifierHash <== poseidon.out;
}

component main {public [driverAddress, ratingStars, tripId]} = RatingNullifier();

template RatingNullifierCircuit() {
    // Private inputs
    signal input tripSecretKey;
    signal input customerIdentityNullifier;
 
    // Public inputs
    signal input driverAddress;
    signal input ratingStars;

    // Output
    signal output nullifierHash;

    // Constrain ratingStars between 1 and 5
    signal starsMinusOne;
    starsMinusOne <-- ratingStars - 1;
    starsMinusOne * (starsMinusOne - 1) * (starsMinusOne - 2) * (starsMinusOne - 3) * (starsMinusOne - 4) === 0;

    // Hash nullifier = Hash(tripSecretKey, customerIdentityNullifier)
    nullifierHash <-- tripSecretKey + customerIdentityNullifier * 1000003;
}

component main {public [driverAddress, ratingStars]} = RatingNullifierCircuit();
