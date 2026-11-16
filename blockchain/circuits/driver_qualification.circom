pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";


/*
 * Helper: IsZero
 *
 * Returns 1 when the input is zero, otherwise 0.
 */
template IsZero() {
    signal input in;
    signal output out;
    signal inv;

    inv <-- in != 0 ? 1 / in : 0;

    out <== 1 - in * inv;

    in * out === 0;
}


/*
 * Helper: IsEqual
 *
 * Returns 1 when the two inputs are equal, otherwise 0.
 */
template IsEqual() {
    signal input in[2];
    signal output out;

    component iz = IsZero();

    iz.in <== in[0] - in[1];

    out <== iz.out;
}


/*
 * DriverQualification
 *
 * Verifies that a driver satisfies the required qualification
 * conditions without revealing private driver information.
 *
 * Public inputs:
 *   driverAddress
 *   currentTripEpochDays
 *   requiredVehicleCategory
 *   expectedCommitment
 *
 * Private inputs:
 *   birthEpochDays
 *   licenseExpiryEpochDays
 *   driverVehicleCategory
 *   backgroundCheckStatus
 *   driverSecretSalt
 *
 * Vehicle categories:
 *   1 = LCV
 *   2 = HCV
 *   3 = Trailer
 */
template DriverQualification() {

    // ============================================================
    // PUBLIC INPUTS
    // ============================================================

    signal input driverAddress;
    signal input currentTripEpochDays;
    signal input requiredVehicleCategory;
    signal input expectedCommitment;


    // ============================================================
    // PRIVATE INPUTS
    // ============================================================

    signal input birthEpochDays;
    signal input licenseExpiryEpochDays;
    signal input driverVehicleCategory;
    signal input backgroundCheckStatus;
    signal input driverSecretSalt;


    // ============================================================
    // OUTPUTS
    // ============================================================

    signal output isQualified;
    signal output identityCommitment;


    // ============================================================
    // 1. RANGE VALIDATION
    // ============================================================

    /*
     * Epoch day values must fit inside 32 bits.
     */

    component currentTripRange = Num2Bits(32);
    currentTripRange.in <== currentTripEpochDays;

    component birthRange = Num2Bits(32);
    birthRange.in <== birthEpochDays;

    component licenseExpiryRange = Num2Bits(32);
    licenseExpiryRange.in <== licenseExpiryEpochDays;


    /*
     * Vehicle categories are small integer values.
     */

    component requiredCategoryRange = Num2Bits(8);
    requiredCategoryRange.in <== requiredVehicleCategory;

    component driverCategoryRange = Num2Bits(8);
    driverCategoryRange.in <== driverVehicleCategory;


    /*
     * Ethereum addresses are 160-bit values.
     */

    component driverAddressRange = Num2Bits(160);
    driverAddressRange.in <== driverAddress;


    /*
     * Background check status must be either 0 or 1.
     */

    component backgroundRange = Num2Bits(1);
    backgroundRange.in <== backgroundCheckStatus;


    // ============================================================
    // 2. AGE CHECK
    // ============================================================

    /*
     * Calculate driver's age in days.
     *
     * 21 years = 21 * 365 = 7665 days.
     */

    signal ageInDays;

    ageInDays <==
        currentTripEpochDays -
        birthEpochDays;


    /*
     * Prevent negative values from wrapping around the field.
     */

    component ageRange = Num2Bits(32);
    ageRange.in <== ageInDays;


    /*
     * Verify:
     *
     * ageInDays >= 7665
     */

    component ageCheck = GreaterEqThan(32);

    ageCheck.in[0] <== ageInDays;
    ageCheck.in[1] <== 7665;

    ageCheck.out === 1;


    // ============================================================
    // 3. LICENSE EXPIRY CHECK
    // ============================================================

    /*
     * Verify:
     *
     * licenseExpiryEpochDays >= currentTripEpochDays
     */

    component expiryCheck = GreaterEqThan(32);

    expiryCheck.in[0] <== licenseExpiryEpochDays;
    expiryCheck.in[1] <== currentTripEpochDays;

    expiryCheck.out === 1;


    // ============================================================
    // 4. DRIVER VEHICLE CATEGORY VALIDATION
    // ============================================================

    /*
     * Driver category must be:
     *
     * 1 = LCV
     * 2 = HCV
     * 3 = Trailer
     */

    component driverCategoryMin = GreaterEqThan(8);

    driverCategoryMin.in[0] <== driverVehicleCategory;
    driverCategoryMin.in[1] <== 1;

    driverCategoryMin.out === 1;


    component driverCategoryMax = LessEqThan(8);

    driverCategoryMax.in[0] <== driverVehicleCategory;
    driverCategoryMax.in[1] <== 3;

    driverCategoryMax.out === 1;


    /*
     * Required category must be:
     *
     * 1 = LCV
     * 2 = HCV
     */

    component requiredCategoryMin = GreaterEqThan(8);

    requiredCategoryMin.in[0] <== requiredVehicleCategory;
    requiredCategoryMin.in[1] <== 1;

    requiredCategoryMin.out === 1;


    component requiredCategoryMax = LessEqThan(8);

    requiredCategoryMax.in[0] <== requiredVehicleCategory;
    requiredCategoryMax.in[1] <== 2;

    requiredCategoryMax.out === 1;


    /*
     * Verify:
     *
     * driverVehicleCategory >= requiredVehicleCategory
     */

    component classCheck = GreaterEqThan(8);

    classCheck.in[0] <== driverVehicleCategory;
    classCheck.in[1] <== requiredVehicleCategory;

    classCheck.out === 1;


    // ============================================================
    // 5. BACKGROUND CHECK
    // ============================================================

    /*
     * Verify:
     *
     * backgroundCheckStatus == 1
     *
     * 1 = Clean
     * 0 = Ineligible
     */

    component backgroundCheck = IsEqual();

    backgroundCheck.in[0] <== backgroundCheckStatus;
    backgroundCheck.in[1] <== 1;

    backgroundCheck.out === 1;


    // ============================================================
    // 6. IDENTITY COMMITMENT
    // ============================================================

    /*
     * Calculate the driver's identity commitment:
     *
     * Poseidon(
     *     driverAddress,
     *     driverSecretSalt,
     *     driverVehicleCategory
     * )
     */

    component hasher = Poseidon(3);

    hasher.inputs[0] <== driverAddress;
    hasher.inputs[1] <== driverSecretSalt;
    hasher.inputs[2] <== driverVehicleCategory;

    identityCommitment <== hasher.out;


    /*
     * Verify that the calculated commitment matches
     * the publicly supplied expected commitment.
     */

    component commitmentCheck = IsEqual();

    commitmentCheck.in[0] <== identityCommitment;
    commitmentCheck.in[1] <== expectedCommitment;

    commitmentCheck.out === 1;


    // ============================================================
    // 7. FINAL QUALIFICATION
    // ============================================================

    /*
     * All qualification conditions must be satisfied:
     *
     * Age check
     *      AND
     * License expiry check
     *      AND
     * Vehicle class check
     *      AND
     * Background check
     */

    signal qualificationStep1;
    signal qualificationStep2;
    signal qualificationStep3;


    qualificationStep1 <==
        ageCheck.out *
        expiryCheck.out;


    qualificationStep2 <==
        qualificationStep1 *
        classCheck.out;


    qualificationStep3 <==
        qualificationStep2 *
        backgroundCheck.out;


    isQualified <== qualificationStep3;


    /*
     * A valid proof can only be generated when
     * the driver is fully qualified.
     */

    isQualified === 1;
}


/*
 * Main circuit
 *
 * Only these values are public:
 *
 *   driverAddress
 *   currentTripEpochDays
 *   requiredVehicleCategory
 *   expectedCommitment
 *
 * All driver-sensitive information remains private.
 */

component main {
    public [
        driverAddress,
        currentTripEpochDays,
        requiredVehicleCategory,
        expectedCommitment
    ]
} = DriverQualification();
