const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ethers } = require('hardhat');

class ZKProofGenerator {
    constructor() {
        this.circuitPath = path.join(__dirname, '../circuits/kyc_verification.circom');
        this.r1csPath = path.join(__dirname, '../circuits/kyc_verification.r1cs');
        this.wasmPath = path.join(__dirname, '../circuits/kyc_verification.wasm');
        this.zkeyPath = path.join(__dirname, '../circuits/kyc_verification.zkey');
        this.vkPath = path.join(__dirname, '../circuits/verification_key.json');
    }

    async generateProof(driverData) {
        try {
            console.log('🔐 Generating ZK-SNARK proof for driver KYC...');
            
            // Step 1: Hash the document
            const documentHash = this.hashDocument(driverData);
            console.log(`📄 Document hash: ${documentHash}`);
            
            // Step 2: Generate witness
            const witness = this.generateWitness(driverData, documentHash);
            console.log('✅ Witness generated');
            
            // Step 3: Generate proof
            const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                witness,
                this.wasmPath,
                this.zkeyPath
            );
            console.log('✅ ZK-SNARK proof generated');
            
            // Step 4: Format for smart contract
            const formattedProof = this.formatProofForContract(proof);
            
            // Step 5: Verify proof locally
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
        const documentString = JSON.stringify({
            name: driverData.name,
            licenseNumber: driverData.licenseNumber,
            rcNumber: driverData.rcNumber,
            insuranceNumber: driverData.insuranceNumber,
            issueDate: driverData.issueDate,
            expiryDate: driverData.expiryDate
        });
        
        return crypto.createHash('sha256').update(documentString).digest('hex');
    }

    generateWitness(driverData, documentHash) {
        // Witness for ZK-SNARK
        // Inputs: name, licenseNumber, rcNumber, insuranceNumber, documentHash
        // Output: boolean (verified or not)
        return {
            name: this.stringToBytes(driverData.name),
            licenseNumber: this.stringToBytes(driverData.licenseNumber),
            rcNumber: this.stringToBytes(driverData.rcNumber),
            insuranceNumber: this.stringToBytes(driverData.insuranceNumber),
            documentHash: documentHash,
            verified: 1
        };
    }

    stringToBytes(str) {
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            bytes.push(str.charCodeAt(i));
        }
        return bytes;
    }

    formatProofForContract(proof) {
        // Format proof for Solidity verifier
        return {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [
                [proof.pi_b[0][0], proof.pi_b[0][1]],
                [proof.pi_b[1][0], proof.pi_b[1][1]]
            ],
            c: [proof.pi_c[0], proof.pi_c[1]],
            input: proof.publicSignals.slice(0, 2)
        };
    }

    async verifyProof(proof, publicSignals) {
        const vKey = JSON.parse(fs.readFileSync(this.vkPath));
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
        // Generate proof
        const proofData = await this.generateProof(driverData);
        
        if (!proofData.isValid) {
            throw new Error('Proof validation failed');
        }
        
        // Deploy verifier (if not already deployed)
        const verifier = await this.deployVerifier();
        
        // Submit proof on-chain
        const receipt = await this.verifyKYCOnChain(
            verifier,
            proofData.proof,
            userAddress
        );
        
        return {
            proofData,
            receipt,
            verifierAddress: await verifier.getAddress()
        };
    }
}

// Example usage
async function main() {
    const generator = new ZKProofGenerator();
    
    // Sample driver data
    const driverData = {
        name: "Rajesh Kumar",
        licenseNumber: "DL-2024-123456",
        rcNumber: "RC-2024-789012",
        insuranceNumber: "INS-2024-345678",
        issueDate: "2024-01-01",
        expiryDate: "2029-01-01"
    };
    
    const userAddress = "0x1234567890123456789012345678901234567890";
    
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
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = ZKProofGenerator;