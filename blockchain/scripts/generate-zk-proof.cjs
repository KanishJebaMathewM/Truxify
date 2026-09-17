const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ROUND_CONSTANTS = [
    0x0c950a76n,
    0x1b4a390en,
    0x2e8f01c2n,
    0x3d7a90b4n,
    0x41ab982cn,
    0x5a23cd10n
];

function mod(value) {
    const result = value % FIELD_MODULUS;
    return result >= 0n ? result : result + FIELD_MODULUS;
}

function pow5(value) {
    const square = mod(value) ** 2n % FIELD_MODULUS;
    const fourth = square * square % FIELD_MODULUS;
    return fourth * mod(value) % FIELD_MODULUS;
}

function poseidon1(input) {
    return pow5(mod(input) + ROUND_CONSTANTS[0]);
}

function poseidon2(left, right) {
    let state0 = mod(left) + ROUND_CONSTANTS[0];
    let state1 = mod(right) + ROUND_CONSTANTS[1];

    state0 = pow5(state0);
    state1 = pow5(state1);

    const mixed0 = mod(2n * state0 + state1 + ROUND_CONSTANTS[2]);
    const mixed1 = mod(state0 + 2n * state1 + ROUND_CONSTANTS[3]);

    state0 = pow5(mixed0);
    state1 = pow5(mixed1);

    const final0 = mod(2n * state0 + state1 + ROUND_CONSTANTS[4]);
    const final1 = mod(state0 + 2n * state1 + ROUND_CONSTANTS[5]);
    return mod(final0 + final1);
}

function hashByteArray(value, maxLength) {
    const bytes = stringToBytes(value, maxLength);
    let packed = 0n;
    for (const byte of bytes) {
        packed = mod(packed * 256n + BigInt(byte));
    }
    return poseidon1(packed);
}

function stringToBytes(value, maxLength) {
    if (typeof value !== 'string') {
        throw new TypeError('KYC document fields must be strings');
    }

    const bytes = Array.from(Buffer.from(value, 'utf8'));
    if (bytes.length > maxLength) {
        throw new RangeError(`KYC field exceeds maximum length of ${maxLength} bytes`);
    }

    return bytes.concat(new Array(maxLength - bytes.length).fill(0));
}

function hashDocument(driverData) {
    const nameHash = hashByteArray(driverData.name, 100);
    const licenseHash = hashByteArray(driverData.licenseNumber, 50);
    const rcHash = hashByteArray(driverData.rcNumber, 50);
    const insuranceHash = hashByteArray(driverData.insuranceNumber, 50);

    return poseidon2(
        poseidon2(nameHash, licenseHash),
        poseidon2(rcHash, insuranceHash)
    ).toString();
}

class ZKProofGenerator {
    constructor() {
        this.circuitPath = path.join(__dirname, '../circuits/kyc_verification.circom');
        this.r1csPath = path.join(__dirname, '../circuits/kyc_verification.r1cs');
        this.wasmPath = path.join(__dirname, '../circuits/kyc_verification.wasm');
        this.zkeyPath = path.join(__dirname, '../circuits/kyc_verification.zkey');
        this.vkPath = path.join(__dirname, '../circuits/verification_key.json');
    }

    generateProof(driverData, userAddress) {
        const documentHash = hashDocument(driverData);
        return this._generateProof(driverData, documentHash, userAddress);
    }

    async _generateProof(driverData, documentHash, userAddress) {
        try {
            console.log('🔐 Generating ZK-SNARK proof for driver KYC...');
            console.log(`📄 Document hash: ${documentHash}`);
            const witness = this.generateWitness(driverData, documentHash, userAddress);
            console.log('✅ Witness generated');

            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                witness,
                this.wasmPath,
                this.zkeyPath
            );
            console.log('✅ ZK-SNARK proof generated');

            const formattedProof = this.formatProofForContract(proof);
            const isValid = await this.verifyProof(proof, publicSignals);

            return {
                proof: formattedProof,
                publicSignals,
                documentHash,
                isValid,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Proof generation failed:', error);
            throw error;
        }
    }

    hashDocument(driverData) {
        return hashDocument(driverData);
    }

    generateWitness(driverData, documentHash, userAddress) {
        return {
            userAddress: userAddress ? BigInt(userAddress).toString() : '0',
            documentHash,
            name: stringToBytes(driverData.name, 100),
            licenseNumber: stringToBytes(driverData.licenseNumber, 50),
            rcNumber: stringToBytes(driverData.rcNumber, 50),
            insuranceNumber: stringToBytes(driverData.insuranceNumber, 50)
        };
    }

    stringToBytes(value, maxLength) {
        return stringToBytes(value, maxLength);
    }

    formatProofForContract(proof) {
        return {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ],
            c: [proof.pi_c[0], proof.pi_c[1]],
            input: proof.publicSignals.slice(0, 2)
        };
    }

    async verifyProof(proof, publicSignals) {
        const vKey = JSON.parse(fs.readFileSync(this.vkPath, 'utf8'));
        return await snarkjs.groth16.verify(vKey, publicSignals, proof);
    }

    async deployVerifier() {
        console.log('🚀 Deploying KYC Verifier contract...');
        const KYCVerifier = await ethers.getContractFactory('KYCVerifier');
        const verifier = await KYCVerifier.deploy();
        await verifier.waitForDeployment();
        const address = await verifier.getAddress();
        console.log(`✅ KYC Verifier deployed at: ${address}`);
        return verifier;
    }

    async verifyKYCOnChain(verifier, proof, userAddress) {
        console.log('🔍 Verifying KYC on-chain...');
        const { a, b, c, input } = proof;
        const tx = await verifier.verifyKYC(a, b, c, input, userAddress);
        const receipt = await tx.wait();
        console.log(`✅ KYC verification completed. Tx: ${receipt.hash}`);
        return receipt;
    }

    async generateAndSubmitProof(driverData, userAddress) {
        const proofData = await this.generateProof(driverData, userAddress);
        if (!proofData.isValid) throw new Error('Proof validation failed');
        const verifier = await this.deployVerifier();
        const receipt = await this.verifyKYCOnChain(verifier, proofData.proof, userAddress);
        return { proofData, receipt, verifierAddress: await verifier.getAddress() };
    }
}

async function main() {
    const generator = new ZKProofGenerator();
    const driverData = {
        name: 'Rajesh Kumar',
        licenseNumber: 'DL-2024-123456',
        rcNumber: 'RC-2024-789012',
        insuranceNumber: 'INS-2024-345678',
        issueDate: '2024-01-01',
        expiryDate: '2029-01-01'
    };
    const userAddress = '0x1234567890123456789012345678901234567890';

    try {
        const result = await generator.generateAndSubmitProof(driverData, userAddress);
        console.log('✅ KYC verification complete!');
        console.log('Proof data:', result.proofData);
        console.log('Transaction:', result.receipt);
        console.log('Verifier contract:', result.verifierAddress);
    } catch (error) {
        console.error('❌ Verification failed:', error);
    }
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = ZKProofGenerator;
module.exports.hashDocument = hashDocument;
module.exports.stringToBytes = stringToBytes;
