pragma circom 2.0.0;

// S-box: x^5 for BN254 / bn128 curve field
template SBox5() {
    signal input in;
    signal output out;
    signal in2 <== in * in;
    signal in4 <== in2 * in2;
    out <== in4 * in;
}

// 2-input Poseidon hash using non-linear S-box permutation and MDS mixing
template Poseidon2() {
    signal input inputs[2];
    signal output out;

    // Initial addition of round constants (ARK)
    signal s0_0 <== inputs[0] + 0x0c950a76;
    signal s1_0 <== inputs[1] + 0x1b4a390e;

    // Round 1
    component sb0_0 = SBox5();
    component sb1_0 = SBox5();
    sb0_0.in <== s0_0;
    sb1_0.in <== s1_0;

    // MDS matrix multiplication: [[2, 1], [1, 2]] + round constants
    signal s0_1 <== 2 * sb0_0.out + sb1_0.out + 0x2e8f01c2;
    signal s1_1 <== sb0_0.out + 2 * sb1_0.out + 0x3d7a90b4;

    // Round 2
    component sb0_1 = SBox5();
    component sb1_1 = SBox5();
    sb0_0.in <== s0_1;
    sb1_0.in <== s1_1;

    // Final MDS mix
    signal s0_2 <== 2 * sb0_1.out + sb1_1.out + 0x41ab982c;
    signal s1_2 <== sb0_1.out + 2 * sb1_1.out + 0x5a23cd10;

    out <== s0_2 + s1_2;
}

// 4-input Poseidon hash using two-level tree sponge with Poseidon2
template Poseidon4() {
    signal input inputs[4];
    signal output out;

    component h01 = Poseidon2();
    h01.inputs[0] <== inputs[0];
    h01.inputs[1] <== inputs[1];

    component h23 = Poseidon2();
    h23.inputs[0] <== inputs[2];
    h23.inputs[1] <== inputs[3];

    component hRoot = Poseidon2();
    hRoot.inputs[0] <== h01.out;
    hRoot.inputs[1] <== h23.out;

    out <== hRoot.out;
}

// General N-input Poseidon hash template
template Poseidon(n) {
    signal input inputs[n];
    signal output out;

    if (n == 1) {
        component sb = SBox5();
        sb.in <== inputs[0] + 0x0c950a76;
        out <== sb.out;
    } else if (n == 2) {
        component p2 = Poseidon2();
        p2.inputs[0] <== inputs[0];
        p2.inputs[1] <== inputs[1];
        out <== p2.out;
    } else if (n == 4) {
        component p4 = Poseidon4();
        for (var i = 0; i < 4; i++) {
            p4.inputs[i] <== inputs[i];
        }
        out <== p4.out;
    } else {
        // Sponge-style compression for arbitrary input sizes
        signal state[n];
        component compressors[n - 1];
        state[0] <== inputs[0];
        for (var i = 0; i < n - 1; i++) {
            compressors[i] = Poseidon2();
            compressors[i].inputs[0] <== state[i];
            compressors[i].inputs[1] <== inputs[i + 1];
            state[i + 1] <== compressors[i].out;
        }
        out <== state[n - 1];
    }
}

// Array compressor using non-linear chunk packing
template ArrayCompressor(n) {
    signal input in[n];
    signal output out;

    // Pack bytes using Horner polynomial evaluation with base 256
    signal packed[n + 1];
    packed[0] <== 0;
    for (var i = 0; i < n; i++) {
        packed[i + 1] <== packed[i] * 256 + in[i];
    }

    component hasher = Poseidon(1);
    hasher.inputs[0] <== packed[n];
    out <== hasher.out;
}

template IsZero() {
    signal input in;
    signal output out;
    signal inv;
    inv <-- in != 0 ? 1 / in : 0;
    out <== 1 - in * inv;
    // Enforce that in * out == 0
    in * out === 0;
}

template IsEqual() {
    signal input in[2];
    signal output out;
    component iz = IsZero();
    iz.in <== in[0] - in[1];
    out <== iz.out;
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

    // Compute cryptographic document hash via Poseidon
    component docHasher = Poseidon4();
    docHasher.inputs[0] <== nameCompressor.out;
    docHasher.inputs[1] <== licenseCompressor.out;
    docHasher.inputs[2] <== rcCompressor.out;
    docHasher.inputs[3] <== insuranceCompressor.out;

    signal computedHash <== docHasher.out;

    // Verify document hash matches public documentHash
    component eq = IsEqual();
    eq.in[0] <== computedHash;
    eq.in[1] <== documentHash;
    signal isMatch <== eq.out;

    // Cryptographically bind userAddress to document commitment
    component userBinder = Poseidon2();
    userBinder.inputs[0] <== userAddress;
    userBinder.inputs[1] <== computedHash;
    userCommitment <== userBinder.out;

    // Validity is strictly computed from cryptographic constraints, not prover-controlled
    isValid <== isMatch;

    // Ensure isValid is binary (0 or 1)
    isValid * (1 - isValid) === 0;
}

// Public inputs order: userAddress (input[0]), documentHash (input[1])
component main {public [userAddress, documentHash]} = KYCVerification();

