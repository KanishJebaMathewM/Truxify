pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Helper: IsZero constraint
template IsZero() {
    signal input in;
    signal output out;
    signal inv;
    inv <-- in != 0 ? 1 / in : 0;
    out <== 1 - in * inv;
    in * out === 0;
}

// Helper: IsEqual constraint
template IsEqual() {
    signal input in[2];
    signal output out;
    component iz = IsZero();
    iz.in <== in[0] - in[1];
    out <== iz.out;
}

// Helper: n-bit comparison (in[0] <= in[1])
template LessEqThan(n) {
    signal input in[2];
    signal output out;

    signal diff;
    diff <-- in[1] - in[0];

    // Constrain diff to be positive within n bits
    signal bits[n];
    var acc = 0;
    for (var i = 0; i < n; i++) {
        bits[i] <-- (diff >> i) & 1;
        bits[i] * (1 - bits[i]) === 0;
        acc += bits[i] * (2 ** i);
    }
    
    // Validate accumulation
    diff === acc;
    out <== 1;
}

// Helper: GreaterEqThan (in[0] >= in[1])
template GreaterEqThan(n) {
    signal input in[2];
    signal output out;

    component le = LessEqThan(n);
    le.in[0] <== in[1];
    le.in[1] <== in[0];
    out <== le.out;
}

/**
 * DriverQualification: Zero-Knowledge Verification Circuit
 * 
 * Verifies that a truck driver meets all regulatory and freight carrier criteria:
 * 1. Age >= 21 years (7,665 days)
 * 2. License Expiry >= Trip Date
 * 3. Driver Vehicle Class >= Required Vehicle Class (1=LCV, 2=HCV)
 * 4. Background Check == 1 (Clean)
 * 5. Identity commitment matches Poseidon(driverAddress, driverSecretSalt, driverVehicleCategory)
 * 
 * Sensitive personal details (DOB, Raw License ID, Aadhaar) remain zero-knowledge private.
 */
template DriverQualification() {
    // Public Inputs
    signal input driverAddress;              // Ethereum address as field element
    signal input currentTripEpochDays;       // Trip schedule date (days since Unix epoch)
    signal input requiredVehicleCategory;    // 1 = LCV, 2 = HCV
    signal input expectedCommitment;         // Public Poseidon commitment

    // Private Inputs
    signal input birthEpochDays;             // Driver birth date in epoch days
    signal input licenseExpiryEpochDays;     // License expiration in epoch days
    signal input driverVehicleCategory;      // Driver certified category (1=LCV, 2=HCV, 3=Trailer)
    signal input backgroundCheckStatus;      // 1 = Clean, 0 = Ineligible
    signal input driverSecretSalt;           // Driver secret blinding factor

    // Public Outputs
    signal output isQualified;
    signal output identityCommitment;

    // 1. Predicate: Age >= 21 Years (21 * 365 = 7665 days)
    signal ageInDays <== currentTripEpochDays - birthEpochDays;
    component ageCheck = GreaterEqThan(32);
    ageCheck.in[0] <== ageInDays;
    ageCheck.in[1] <== 7665;

    // 2. Predicate: License Expiry >= Trip Date
    component expiryCheck = GreaterEqThan(32);
    expiryCheck.in[0] <== licenseExpiryEpochDays;
    expiryCheck.in[1] <== currentTripEpochDays;

    // 3. Predicate: Vehicle Class >= Required Class
    component classCheck = GreaterEqThan(8);
    classCheck.in[0] <== driverVehicleCategory;
    classCheck.in[1] <== requiredVehicleCategory;

    // 4. Predicate: Clean Background Check == 1
    component bgCheck = IsEqual();
    bgCheck.in[0] <== backgroundCheckStatus;
    bgCheck.in[1] <== 1;
    bgCheck.out === 1;

    // 5. Identity Commitment Hash Binding
    component hasher = Poseidon(3);
    hasher.inputs[0] <== driverAddress;
    hasher.inputs[1] <== driverSecretSalt;
    hasher.inputs[2] <== driverVehicleCategory;
    identityCommitment <== hasher.out;

    // Verify computed commitment matches public commitment
    component commitCheck = IsEqual();
    commitCheck.in[0] <== identityCommitment;
    commitCheck.in[1] <== expectedCommitment;
    commitCheck.out === 1;

    // Output overall qualification flag (constrained to 1)
    signal qualStep1 <== ageCheck.out * expiryCheck.out;
    signal qualStep2 <== qualStep1 * classCheck.out;
    isQualified <== qualStep2 * bgCheck.out;
    isQualified === 1;
}

component main {public [driverAddress, currentTripEpochDays, requiredVehicleCategory, expectedCommitment]} = DriverQualification();
