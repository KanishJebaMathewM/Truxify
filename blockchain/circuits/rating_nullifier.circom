pragma circom 2.0.0;

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
