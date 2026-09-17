pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template IsZero() {
    signal input in;
    signal output out;
    signal inv;
    inv <-- in != 0 ? 1 / in : 0;
    out <== 1 - in * inv;
    in * out === 0;
}

template IsEqual() {
    signal input in[2];
    signal output out;
    component iz = IsZero();
    iz.in <== in[0] - in[1];
    out <== iz.out;
}

// Array compressor using a standard circomlib Poseidon permutation.
template ArrayCompressor(n) {
    signal input in[n];
    signal output out;

    // Keep the existing fixed-width byte packing semantics while delegating
    // the cryptographic permutation to the audited circomlib implementation.
    signal packed[n + 1];
    packed[0] <== 0;
    for (var i = 0; i < n; i++) {
        packed[i + 1] <== packed[i] * 256 + in[i];
    }

    component hasher = Poseidon(1);
    hasher.inputs[0] <== packed[n];
    out <== hasher.out;
}

// ZK-SNARK circuit for KYC verification
template KYCVerification() {
    // Public inputs (bound in KYCVerifier.sol: input[0] == userAddress, input[1] == documentHash)
    signal input userAddress;
    signal input documentHash;

    // Private inputs (driver document payload)
    signal input name[100];
    signal input licenseNumber[50];
    signal input rcNumber[50];
    signal input insuranceNumber[50];

    // Public outputs
    signal output isValid;
    signal output userCommitment;

    // Compress document attribute arrays into non-linear field elements
    component nameCompressor = ArrayCompressor(100);
    for (var i = 0; i < 100; i++) {
        nameCompressor.in[i] <== name[i];
    }

    component licenseCompressor = ArrayCompressor(50);
    for (var i = 0; i < 50; i++) {
        licenseCompressor.in[i] <== licenseNumber[i];
    }

    component rcCompressor = ArrayCompressor(50);
    for (var i = 0; i < 50; i++) {
        rcCompressor.in[i] <== rcNumber[i];
    }

    component insuranceCompressor = ArrayCompressor(50);
    for (var i = 0; i < 50; i++) {
        insuranceCompressor.in[i] <== insuranceNumber[i];
    }

    // Standard circomlib Poseidon over the four compressed attributes.
    component docHasher = Poseidon(4);
    for (var j = 0; j < 4; j++) {
        if (j == 0) {
            docHasher.inputs[j] <== nameCompressor.out;
        } else if (j == 1) {
            docHasher.inputs[j] <== licenseCompressor.out;
        } else if (j == 2) {
            docHasher.inputs[j] <== rcCompressor.out;
        } else {
            docHasher.inputs[j] <== insuranceCompressor.out;
        }
    }

    signal computedHash <== docHasher.out;

    // Verify document hash matches public documentHash
    component eq = IsEqual();
    eq.in[0] <== computedHash;
    eq.in[1] <== documentHash;
    signal isMatch <== eq.out;

    // Cryptographically bind userAddress to document commitment.
    component userBinder = Poseidon(2);
    userBinder.inputs[0] <== userAddress;
    userBinder.inputs[1] <== computedHash;
    userCommitment <== userBinder.out;

    // Validity is strictly computed from cryptographic constraints.
    isValid <== isMatch;
    isValid * (1 - isValid) === 0;
}

// Public inputs order: userAddress (input[0]), documentHash (input[1])
component main {public [userAddress, documentHash]} = KYCVerification();
