pragma circom 2.1.0;

template DriverCredentialVerifier() {
    // Private Inputs (Kept off-chain, never published)
    signal input isLicenseValid;      
    signal input isInsuranceActive;   
    signal input isPermitValid;      
    signal input driverSecretSalt;   

    // Public Inputs (Passed to Polygon smart contract)
    signal input expectedCommitment; 

    // Output Proof Signal
    signal output isValid;

    // Constraint Checks: All three credentials must equal 1
    signal step1;
    step1 <-- isLicenseValid * isInsuranceActive;
    step1 === 1;

    signal step2;
    step2 <-- step1 * isPermitValid;
    step2 === 1;

    isValid <-- step2;
    isValid === 1;
}

component main {public [expectedCommitment]} = DriverCredentialVerifier();