pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1 = 0;
    var e2 = 1;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 += out[i] * e2;
        e2 = e2 + e2;
    }
    lc1 === in;
}

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

template Switcher() {
    signal input sel;
    signal input L;
    signal input R;
    signal output outL;
    signal output outR;

    signal aux;
    aux <== (R - L) * sel;
    outL <== aux + L;
    outR <== -aux + R;
}

// Array compressor using a standard circomlib Poseidon permutation.
// Adds 8-bit range checks and non-empty checks for document fields.
template ArrayCompressor(n) {
    signal input in[n];
    signal output out;

    // 8-bit range checks for all byte inputs
    component rangeCheck[n];
    for (var i = 0; i < n; i++) {
        rangeCheck[i] = Num2Bits(8);
        rangeCheck[i].in <== in[i];
    }

    // Non-empty check: ensure the document field is not empty (first byte != 0)
    component notEmpty = IsZero();
    notEmpty.in <== in[0];
    notEmpty.out === 0;

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
    // Public inputs (bound in KYCVerifier.sol: input[0] == userAddress, input[1] == documentHash, input[2] == merkleRoot)
    signal input userAddress;
    signal input documentHash;
    signal input merkleRoot;

    // Private inputs (driver document payload)
    signal input name[100];
    signal input licenseNumber[50];
    signal input rcNumber[50];
    signal input insuranceNumber[50];

    // Merkle membership proof inputs (depth 10)
    signal input merklePathElements[10];
    signal input merklePathIndices[10];

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
    docHasher.inputs[0] <== nameCompressor.out;
    docHasher.inputs[1] <== licenseCompressor.out;
    docHasher.inputs[2] <== rcCompressor.out;
    docHasher.inputs[3] <== insuranceCompressor.out;

    signal computedHash <== docHasher.out;

    // Constrain computedHash === documentHash
    computedHash === documentHash;

    // Cryptographically bind userAddress to document commitment.
    component userBinder = Poseidon(2);
    userBinder.inputs[0] <== userAddress;
    userBinder.inputs[1] <== computedHash;
    userCommitment <== userBinder.out;

    // Merkle membership verification with depth 10 using Switcher and Poseidon(2)
    component switcher[10];
    component levelHasher[10];

    for (var k = 0; k < 10; k++) {
        // Enforce path index is binary (0 or 1)
        merklePathIndices[k] * (merklePathIndices[k] - 1) === 0;

        switcher[k] = Switcher();
        switcher[k].sel <== merklePathIndices[k];
        if (k == 0) {
            switcher[k].L <== userCommitment;
            switcher[k].R <== merklePathElements[0];
        } else {
            switcher[k].L <== levelHasher[k - 1].out;
            switcher[k].R <== merklePathElements[k];
        }

        levelHasher[k] = Poseidon(2);
        levelHasher[k].inputs[0] <== switcher[k].outL;
        levelHasher[k].inputs[1] <== switcher[k].outR;
    }

    // Constrain computed root to equal public merkleRoot
    levelHasher[9].out === merkleRoot;

    // Set isValid strictly to 1 upon meeting all constraints
    isValid <== 1;
}

// Public inputs order: userAddress (input[0]), documentHash (input[1]), merkleRoot (input[2])
component main {public [userAddress, documentHash, merkleRoot]} = KYCVerification();
